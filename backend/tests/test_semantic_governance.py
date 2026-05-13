"""
Unit tests for semantic_governance.py

No external connections required.  BigQuery and Supabase calls are mocked.
Run from the backend/ directory:
    python -m pytest tests/test_semantic_governance.py -v
"""
import os
import sys
import types
import tempfile
import unittest
from datetime import date
from unittest.mock import MagicMock

# ── Bootstrap: inject a fake config module before importing semantic_governance ─
# This avoids touching real env vars and prevents the module-level date
# assignments (_DATE_START_SUFFIX, _DATE_END_SUFFIX) from failing.
_mock_config = types.ModuleType("config")
_mock_config.WORKSPACE_ID       = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
_mock_config.DATE_RANGE_START        = date(2025, 1, 1)
_mock_config.DATE_RANGE_END          = date(2025, 1, 31)
_mock_config.GCP_PROJECT_ID          = "test-project"
_mock_config.GOOGLE_ADS_DATASET      = "test_ads_dataset"
_mock_config.GOOGLE_ADS_CUSTOMER_ID  = "1234567890"
sys.modules.setdefault("config", _mock_config)

_CONNECTORS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "connectors"))
if _CONNECTORS_DIR not in sys.path:
    sys.path.insert(0, _CONNECTORS_DIR)

from semantic_governance import (
    MAX_EVIDENCE_ROWS_PER_FINDING,
    _PARAM_ALLOWLIST_RE,
    _dedupe_preserve_order,
    _review_required_actions,
    _write_finding_evidence,
    check_utm_campaign_empty_in_paid_urls,
    classify_url_environment,
    load_measurement_config,
    start_governance_run,
    write_governance_findings,
)


# ─────────────────────────────────────────────────────────────────────────────

class TestDedupePreserveOrder(unittest.TestCase):
    def test_removes_duplicates_preserves_order(self):
        self.assertEqual(
            _dedupe_preserve_order(["b", "a", "c", "b", "a"]),
            ["b", "a", "c"],
        )

    def test_empty_list_returns_empty(self):
        self.assertEqual(_dedupe_preserve_order([]), [])

    def test_no_duplicates_unchanged(self):
        self.assertEqual(_dedupe_preserve_order(["x", "y", "z"]), ["x", "y", "z"])

    def test_falsy_values_stripped(self):
        self.assertEqual(_dedupe_preserve_order(["a", "", "b", ""]), ["a", "b"])


# ─────────────────────────────────────────────────────────────────────────────

class TestLoadMeasurementConfig(unittest.TestCase):
    def test_missing_file_returns_none(self):
        self.assertIsNone(load_measurement_config("/nonexistent/path/config.yml"))

    def test_empty_path_returns_none(self):
        self.assertIsNone(load_measurement_config(""))

    def test_valid_config_loads(self):
        content = """\
tenant:
  workspace_id: "abc-123"
  name: "Test Tenant"
  slug: "test"
sources:
  ga4_dataset: "analytics_123"
  google_ads_dataset: "raw_ads"
  google_ads_customer_id: "999"
conversion_registry:
  canonical_events: {}
semantic_checks:
  enabled: true
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".yml", delete=False, encoding="utf-8"
        ) as f:
            f.write(content)
            path = f.name
        try:
            result = load_measurement_config(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["tenant"]["slug"], "test")
        finally:
            os.unlink(path)


# ─────────────────────────────────────────────────────────────────────────────

class TestReviewRequiredActions(unittest.TestCase):
    _config = {
        "conversion_registry": {
            "canonical_events": {
                "good": {
                    "event_name": "signup",
                    "type": "conversion",
                    "status": "validated",
                },
                "tech_alias": {
                    "event_name": "USER_SIGNUP_AUTO",
                    "type": "technical_conversion_alias",
                    "status": "validated_in_ads_but_semantic_review_required",
                },
            },
            "ads_only_conversion_actions": {
                "ads_lead": {
                    "type": "ads_only_conversion",
                    "status": "semantic_review_required",
                },
            },
        }
    }

    def test_finds_technical_conversion_alias(self):
        result = _review_required_actions(self._config)
        event_names = [e.get("event_name") for e in result]
        self.assertIn("USER_SIGNUP_AUTO", event_names)

    def test_excludes_validated_event(self):
        result = _review_required_actions(self._config)
        event_names = [e.get("event_name") for e in result]
        self.assertNotIn("signup", event_names)

    def test_includes_ads_only_review_required(self):
        result = _review_required_actions(self._config)
        self.assertEqual(len(result), 2)  # tech alias + ads_only

    def test_empty_registry_returns_empty(self):
        self.assertEqual(_review_required_actions({}), [])


# ─────────────────────────────────────────────────────────────────────────────

_DOMAINS = {
    "production": ["app.wokepeople.com", "mentor.wokepeople.com"],
    "staging":    ["mentor-stg.wokepeople.com"],
    "local":      ["localhost"],
}


class TestClassifyUrlEnvironment(unittest.TestCase):
    def test_production(self):
        self.assertEqual(
            classify_url_environment("https://app.wokepeople.com/signup", _DOMAINS),
            "production",
        )

    def test_staging(self):
        self.assertEqual(
            classify_url_environment("https://mentor-stg.wokepeople.com/signup", _DOMAINS),
            "staging",
        )

    def test_local_by_config(self):
        self.assertEqual(
            classify_url_environment("http://localhost:3000/signup", _DOMAINS),
            "local",
        )

    def test_local_bare_localhost(self):
        self.assertEqual(
            classify_url_environment("http://localhost/path", _DOMAINS),
            "local",
        )

    def test_preview_vercel(self):
        self.assertEqual(
            classify_url_environment("https://synapse-pr-42.vercel.app/signup", _DOMAINS),
            "preview",
        )

    def test_preview_netlify(self):
        self.assertEqual(
            classify_url_environment("https://deploy-preview-7--mysite.netlify.app/", _DOMAINS),
            "preview",
        )

    def test_unknown(self):
        self.assertEqual(
            classify_url_environment("https://other.example.com/page", _DOMAINS),
            "unknown",
        )

    def test_empty_string_returns_unknown(self):
        self.assertEqual(classify_url_environment("", _DOMAINS), "unknown")

    def test_debug_param_overrides_production_domain(self):
        # A URL on a production domain with ?debug=1 must classify as 'debug'
        self.assertEqual(
            classify_url_environment(
                "https://app.wokepeople.com/signup?debug=1&utm_source=google",
                _DOMAINS,
            ),
            "debug",
        )

    def test_debug_param_no_value(self):
        # ?debug without = value still signals debug environment
        self.assertEqual(
            classify_url_environment("https://app.wokepeople.com/?debug", _DOMAINS),
            "debug",
        )

    def test_debug_overrides_staging(self):
        self.assertEqual(
            classify_url_environment(
                "https://mentor-stg.wokepeople.com/?debug=true",
                _DOMAINS,
            ),
            "debug",
        )


# ─────────────────────────────────────────────────────────────────────────────

class TestParamAllowlist(unittest.TestCase):
    def test_valid_params_pass(self):
        valid = ["gclid", "utm_source", "utm_medium", "utm_campaign",
                 "campaign_id", "adgroup_id", "utm_content", "fbclid"]
        for p in valid:
            self.assertIsNotNone(
                _PARAM_ALLOWLIST_RE.match(p), f"{p!r} should pass allowlist"
            )

    def test_invalid_params_rejected(self):
        invalid = ["bad<param", "a b", "foo;bar", "x=y", "a.b", "utm-source", ""]
        for p in invalid:
            self.assertIsNone(
                _PARAM_ALLOWLIST_RE.match(p), f"{p!r} should be rejected"
            )


# ─────────────────────────────────────────────────────────────────────────────

def _make_bq_mock_for_check_s(params, total=100, **has_counts):
    """Build a minimal BQ mock for check S tests."""
    mock_row = MagicMock()
    mock_row.total_paid_views = total
    for p in params:
        setattr(mock_row, f"has_{p}", has_counts.get(f"has_{p}", total))
    mock_result = MagicMock()
    mock_result.result.return_value = [mock_row]
    mock_bq = MagicMock()
    mock_bq.query.return_value = mock_result
    return mock_bq, mock_row


class TestCheckSUTMParams(unittest.TestCase):
    _tables = ["events_20250101", "events_20250115"]

    def test_all_configured_params_appear_in_query(self):
        params = ["utm_source", "utm_medium", "utm_campaign"]
        config = {"attribution": {"required_paid_url_params": params}}
        captured_sql = []
        mock_row = MagicMock()
        mock_row.total_paid_views = 10
        for p in params:
            setattr(mock_row, f"has_{p}", 10)
        mock_result = MagicMock()
        mock_result.result.return_value = [mock_row]
        mock_bq = MagicMock()
        mock_bq.query.side_effect = lambda sql: (captured_sql.append(sql) or mock_result)

        check_utm_campaign_empty_in_paid_urls(config, mock_bq, "analytics_123", self._tables)

        self.assertEqual(len(captured_sql), 1)
        for p in params:
            self.assertIn(f"has_{p}", captured_sql[0], f"param {p!r} missing from query")

    def test_missing_params_reported_in_details(self):
        params = ["utm_source", "utm_campaign"]
        config = {"attribution": {"required_paid_url_params": params}}
        mock_bq, _ = _make_bq_mock_for_check_s(params, total=10, has_utm_source=10, has_utm_campaign=5)

        result = check_utm_campaign_empty_in_paid_urls(config, mock_bq, "analytics_123", self._tables)

        self.assertEqual(result["status"], "warning")
        self.assertIn("utm_campaign", result["details"]["missing_params"])
        self.assertNotIn("utm_source", result["details"]["missing_params"])

    def test_all_params_present_returns_passed(self):
        params = ["utm_source", "utm_campaign"]
        config = {"attribution": {"required_paid_url_params": params}}
        mock_bq, _ = _make_bq_mock_for_check_s(params, total=10)

        result = check_utm_campaign_empty_in_paid_urls(config, mock_bq, "analytics_123", self._tables)

        self.assertEqual(result["status"], "passed")

    def test_invalid_param_is_rejected_and_not_in_query(self):
        config = {"attribution": {"required_paid_url_params": ["utm_source", "bad<param"]}}
        captured_sql = []
        mock_row = MagicMock()
        mock_row.total_paid_views = 10
        mock_row.has_utm_source = 10
        mock_result = MagicMock()
        mock_result.result.return_value = [mock_row]
        mock_bq = MagicMock()
        mock_bq.query.side_effect = lambda sql: (captured_sql.append(sql) or mock_result)

        result = check_utm_campaign_empty_in_paid_urls(
            config, mock_bq, "analytics_123", self._tables
        )

        self.assertTrue(len(captured_sql) >= 1, "BQ query should have been called")
        self.assertIn("has_utm_source", captured_sql[0])
        self.assertNotIn("bad", captured_sql[0])
        # Result must not raise; function completes cleanly
        self.assertIn(result["status"], ("passed", "warning"))

    def test_no_valid_params_returns_passed(self):
        config = {"attribution": {"required_paid_url_params": ["bad<p", "x y"]}}
        mock_bq = MagicMock()

        result = check_utm_campaign_empty_in_paid_urls(
            config, mock_bq, "analytics_123", self._tables
        )

        self.assertEqual(result["status"], "passed")
        mock_bq.query.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────

class TestDryRunNoPersistence(unittest.TestCase):
    def test_start_governance_run_dry_run_returns_none(self):
        mock_supabase = MagicMock()
        result = start_governance_run(mock_supabase, {"tenant": {"slug": "test"}}, dry_run=True)
        self.assertIsNone(result)
        mock_supabase.table.assert_not_called()

    def test_write_findings_dry_run_makes_no_supabase_calls(self):
        mock_supabase = MagicMock()
        results = [{
            "check_name": "test_check", "status": "warning", "severity": "medium",
            "source_platform": "ga4", "affected_rows": 1,
            "metric_value": None, "threshold_value": None,
            "details": {"items": [{"a": 1}]},
            "date_range_start": "2025-01-01", "date_range_end": "2025-01-31",
        }]
        written = write_governance_findings(mock_supabase, "fake-run-id", results, dry_run=True)
        self.assertEqual(written, 0)
        mock_supabase.table.assert_not_called()

    def test_write_findings_no_run_id_returns_zero(self):
        mock_supabase = MagicMock()
        written = write_governance_findings(mock_supabase, None, [{"check_name": "x"}])
        self.assertEqual(written, 0)
        mock_supabase.table.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────

class TestEvidenceCap(unittest.TestCase):
    def test_evidence_list_truncated_to_max(self):
        large_list = [{"item": i} for i in range(MAX_EVIDENCE_ROWS_PER_FINDING + 10)]
        mock_supabase = MagicMock()

        _write_finding_evidence(mock_supabase, "finding-uuid-123", {"events": large_list})

        mock_supabase.table.assert_called_once_with("semantic_governance_evidence")
        inserted = mock_supabase.table.return_value.insert.call_args[0][0]
        self.assertEqual(len(inserted), MAX_EVIDENCE_ROWS_PER_FINDING)

    def test_evidence_within_limit_not_truncated(self):
        small_list = [{"item": i} for i in range(5)]
        mock_supabase = MagicMock()

        _write_finding_evidence(mock_supabase, "finding-uuid-456", {"events": small_list})

        inserted = mock_supabase.table.return_value.insert.call_args[0][0]
        self.assertEqual(len(inserted), 5)

    def test_non_list_details_produce_no_evidence(self):
        mock_supabase = MagicMock()
        _write_finding_evidence(mock_supabase, "finding-uuid-789", {
            "count": 42,
            "reason": "some string",
            "flag": True,
        })
        mock_supabase.table.assert_not_called()

    def test_scalar_items_wrapped_in_value_key(self):
        mock_supabase = MagicMock()
        _write_finding_evidence(mock_supabase, "finding-uuid-000", {"tags": ["a", "b"]})
        inserted = mock_supabase.table.return_value.insert.call_args[0][0]
        self.assertEqual(inserted[0]["evidence_data"], {"value": "a"})
        self.assertEqual(inserted[1]["evidence_data"], {"value": "b"})


# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main()
