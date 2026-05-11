import os
import sys
import re
from datetime import datetime, timezone, date as date_type
from typing import Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from config import (
    WOKE_WORKSPACE_ID,
    DATE_RANGE_START,
    DATE_RANGE_END,
    GCP_PROJECT_ID,
    GOOGLE_ADS_DATASET,
    GOOGLE_ADS_CUSTOMER_ID,
)
from operational_events import record_operational_event # Novo import

_DATE_START_SUFFIX = DATE_RANGE_START.strftime("%Y%m%d")
_DATE_END_SUFFIX   = DATE_RANGE_END.strftime("%Y%m%d")

# Keywords that suggest an event is conversion-related
_CONVERSION_KEYWORDS = [
    "signup", "sign_up", "success", "lead", "submit", "criar", "conversion",
    "convert", "register", "cadastro", "purchase", "checkout", "buy",
    "complete", "finish", "mentor_signup", "app_criar",
]

MAX_EVIDENCE_ROWS_PER_FINDING = 25

# Param names must satisfy this allowlist before SQL interpolation
_PARAM_ALLOWLIST_RE = re.compile(r"^[a-zA-Z0-9_]+$")


# ── Config loading ─────────────────────────────────────────────────────────────

def load_measurement_config(path: str) -> Optional[dict]:
    """
    Load and validate YAML config from path.
    Returns None (with a printed warning) if path is missing, unreadable, or invalid.
    Never raises — calling code can always treat None as 'governance skipped'.
    """
    if not path:
        print("[semantic_governance] MEASUREMENT_CONFIG_PATH not set — skipping", flush=True)
        return None

    try:
        import yaml
    except ImportError:
        print("[semantic_governance] PyYAML not installed — skipping (pip install PyYAML)", flush=True)
        return None

    if not os.path.exists(path):
        print(f"[semantic_governance] config not found: {path!r} — skipping", flush=True)
        return None

    try:
        with open(path, encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
    except Exception as exc:
        print(f"[semantic_governance] config read error: {exc} — skipping", flush=True)
        return None

    if not isinstance(cfg, dict):
        print("[semantic_governance] config is not a YAML mapping — skipping", flush=True)
        return None

    missing = [k for k in ("tenant", "sources", "conversion_registry") if k not in cfg]
    if missing:
        print(f"[semantic_governance] config missing required keys {missing} — skipping", flush=True)
        return None

    semantic_enabled = cfg.get("semantic_checks", {}).get("enabled", True)
    if not semantic_enabled:
        print("[semantic_governance] semantic_checks.enabled=false — skipping", flush=True)
        return None

    tenant = cfg.get("tenant", {})
    print(
        f"[semantic_governance] loaded config for tenant='{tenant.get('name', '?')}' "
        f"slug='{tenant.get('slug', '?')}'",
        flush=True,
    )
    return cfg


# ── Config helpers ─────────────────────────────────────────────────────────────

def _all_registry_names(config: dict) -> set:
    names = set()
    reg = config.get("conversion_registry", {})
    for section in ("canonical_events", "intermediate_events", "intent_events"):
        for entry in reg.get(section, {}).values():
            names.add(entry.get("event_name", ""))
            names.update(entry.get("aliases", []))
    return {n for n in names if n}


def _funnel_event_names(config: dict) -> list:
    names = []
    reg = config.get("conversion_registry", {})
    for section in ("intent_events", "intermediate_events", "canonical_events"):
        for entry in reg.get(section, {}).values():
            names.append(entry.get("event_name", ""))
            names.extend(entry.get("aliases", []))
    return [n for n in names if n]


def _registry_ads_action_names(config: dict) -> set:
    names = set()
    for entry in config.get("conversion_registry", {}).get("canonical_events", {}).values():
        action = entry.get("ads_conversion_action", {})
        if action.get("name"):
            names.add(action["name"])
    return names


def _registry_ads_actions(config: dict) -> tuple[set, set]:
    """Return (names, resource_ids) for all registered Ads conversion actions.

    Scans both canonical_events (which may have ads_conversion_action sub-keys)
    and ads_only_conversion_actions (Ads-only actions without a GA4 counterpart).
    """
    names = set()
    ids   = set()
    reg   = config.get("conversion_registry", {})
    for section in ("canonical_events", "ads_only_conversion_actions"):
        for entry in reg.get(section, {}).values():
            action = entry.get("ads_conversion_action", {})
            if action.get("name"):
                names.add(action["name"])
            if action.get("id"):
                ids.add(action["id"])
    return names, ids


def _review_required_actions(config: dict) -> list:
    """Return all registry entries that require semantic review.

    Covers:
    - canonical_events where type is technical_conversion_alias or status contains
      semantic_review_required
    - ads_only_conversion_actions where status contains review_required
    """
    out = []
    reg = config.get("conversion_registry", {})
    for entry in reg.get("canonical_events", {}).values():
        if (
            entry.get("type") == "technical_conversion_alias"
            or "semantic_review_required" in entry.get("status", "")
        ):
            out.append(entry)
    for entry in reg.get("ads_only_conversion_actions", {}).values():
        if "review_required" in entry.get("status", ""):
            out.append(entry)
    return out


def _dedupe_preserve_order(values: list) -> list:
    seen = set()
    result = []
    for v in values:
        if v and v not in seen:
            seen.add(v)
            result.append(v)
    return result


def _safe_sql_list(values: list) -> str:
    return ", ".join(f"'{v.replace(chr(39), chr(39)+chr(39))}'" for v in values)


def _redact_gclid(url: str) -> str:
    return re.sub(r"(gclid=)[^&#+\s]*", r"\1[redacted]", url or "")


def classify_url_environment(url: str, domains_cfg: dict) -> str:
    """Classify a URL into one of six environment buckets.

    Priority: debug → local → staging → preview → production → unknown.
    Non-production signals are checked first so that a debug session on a
    production domain is reported as 'debug', not 'production'.
    """
    if not url:
        return "unknown"
    url_lower = url.lower()

    # debug: URL carries an explicit debug query parameter
    if re.search(r"[?&]debug(?:=[^&#]*)?(?:[&#]|$)", url_lower):
        return "debug"

    # local: configured local domains + well-known localhost patterns
    for domain in domains_cfg.get("local", []):
        if domain and domain.lower() in url_lower:
            return "local"
    if re.search(r"localhost(?::\d+)?(?:[/?#]|$)", url_lower):
        return "local"

    # staging: configured staging domains
    for domain in domains_cfg.get("staging", []):
        if domain and domain.lower() in url_lower:
            return "staging"

    # preview: common preview hosting patterns
    if re.search(
        r"(?:vercel\.app|netlify\.app|netlify\.com|pr-\d+\.|preview[-.])",
        url_lower,
    ):
        return "preview"

    # production: configured production domains
    for domain in domains_cfg.get("production", []):
        if domain and domain.lower() in url_lower:
            return "production"

    return "unknown"


# ── Shared result builder ──────────────────────────────────────────────────────

def _result(
    check_name: str,
    status: str,
    severity: str,
    source_platform: str = "ga4",
    target_table: str = "insight_feed",
    affected_rows: int = 0,
    metric_value: Optional[float] = None,
    threshold_value: Optional[float] = None,
    details: Optional[dict] = None,
) -> dict:
    return {
        "workspace_id":     WOKE_WORKSPACE_ID,
        "check_name":       check_name,
        "check_category":   "semantic_governance",
        "status":           status,
        "severity":         severity,
        "source_platform":  source_platform,
        "target_table":     target_table,
        "metric_value":     metric_value,
        "threshold_value":  threshold_value,
        "affected_rows":    affected_rows,
        "details":          details,
        "date_range_start": str(DATE_RANGE_START),
        "date_range_end":   str(DATE_RANGE_END),
    }


# ── Semantic insight builder ───────────────────────────────────────────────────

def _insight(
    insight_type: str,
    severity: str,
    title: str,
    summary: str,
    recommendation: str,
    evidence: dict,
    source_tables: list,
    confidence: float,
    dedupe_key: str,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "workspace_id":     WOKE_WORKSPACE_ID,
        "insight_type":     insight_type,
        "severity":         severity,
        "status":           "new",
        "title":            title,
        "summary":          summary,
        "recommendation":   recommendation,
        "evidence":         evidence,
        "source_tables":    source_tables,
        "confidence":       confidence,
        "date_range_start": str(DATE_RANGE_START),
        "date_range_end":   str(DATE_RANGE_END),
        "dedupe_key":       dedupe_key,
        "updated_at":       now,
    }


# ── Persistence helpers ────────────────────────────────────────────────────────

def start_governance_run(
    supabase,
    config: dict,
    dry_run: bool = False,
) -> Optional[str]:
    """Insert a semantic_governance_runs row. Returns run_id or None.

    Returns None on dry_run or any Supabase error — never raises.
    The pipeline continues regardless; persistence is best-effort.
    """
    if dry_run:
        return None
    tenant = config.get("tenant", {})
    try:
        resp = (
            supabase.table("semantic_governance_runs")
            .insert({
                "workspace_id":     WOKE_WORKSPACE_ID,
                "tenant_slug":      tenant.get("slug", "unknown"),
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
                "status":           "running",
            })
            .execute()
        )
        rows = resp.data or []
        if rows:
            return rows[0]["id"]
        print("[semantic_governance] WARNING: start_governance_run insert returned no id", flush=True)
        return None
    except Exception as exc:
        print(f"[semantic_governance] WARNING: could not start governance run: {exc}", flush=True)
        return None


def finish_governance_run(
    supabase,
    run_id: Optional[str],
    results: list,
    dry_run: bool = False,
    error: Optional[str] = None,
) -> bool:
    """Update governance run to 'success' or 'error'. Returns True if written.

    Non-fatal: prints a warning and returns False on any error.
    review_required findings are counted as warnings, not errors — they are
    informational and never cause the run to be marked as error.
    """
    if dry_run or not run_id:
        return False
    findings_count = sum(1 for r in results if r.get("status") in ("warning", "failed"))
    try:
        supabase.table("semantic_governance_runs").update({
            "status":         "error" if error else "success",
            "finished_at":    datetime.now(timezone.utc).isoformat(),
            "checks_run":     len(results),
            "findings_count": findings_count,
            "error_message":  error,
        }).eq("id", run_id).execute()
        return True
    except Exception as exc:
        print(f"[semantic_governance] WARNING: could not finish governance run: {exc}", flush=True)
        return False


def _write_finding_evidence(supabase, finding_id: str, details: dict) -> None:
    """Persist list-type values from a finding's details as evidence rows.

    Caps each list at MAX_EVIDENCE_ROWS_PER_FINDING to avoid unbounded inserts.
    Non-fatal: prints a warning on any error.
    """
    rows_to_insert = []
    for key, value in details.items():
        if not isinstance(value, list) or not value:
            continue
        items = value[:MAX_EVIDENCE_ROWS_PER_FINDING]
        if len(value) > MAX_EVIDENCE_ROWS_PER_FINDING:
            print(
                f"[semantic_governance] evidence '{key}' truncated to "
                f"{MAX_EVIDENCE_ROWS_PER_FINDING}/{len(value)} rows",
                flush=True,
            )
        for item in items:
            rows_to_insert.append({
                "finding_id":    finding_id,
                "evidence_type": key,
                "evidence_data": item if isinstance(item, dict) else {"value": item},
            })
    if rows_to_insert:
        try:
            supabase.table("semantic_governance_evidence").insert(rows_to_insert).execute()
        except Exception as exc:
            print(f"[semantic_governance] WARNING: could not write evidence: {exc}", flush=True)


def write_governance_findings(
    supabase,
    run_id: Optional[str],
    results: list,
    dry_run: bool = False,
) -> int:
    """Insert findings and evidence for a governance run.

    Returns number of findings written. Non-fatal: per-finding errors are
    logged as warnings and skipped; the run continues.
    """
    if dry_run:
        print(
            f"[semantic_governance] --dry-run: would write {len(results)} findings",
            flush=True,
        )
        return 0
    if not run_id:
        return 0

    written = 0
    for r in results:
        finding_row = {
            "run_id":           run_id,
            "workspace_id":     WOKE_WORKSPACE_ID,
            "check_name":       r["check_name"],
            "status":           r["status"],
            "severity":         r["severity"],
            "source_platform":  r.get("source_platform", "ga4"),
            "affected_rows":    r.get("affected_rows", 0),
            "metric_value":     r.get("metric_value"),
            "threshold_value":  r.get("threshold_value"),
            "details":          r.get("details"),
            "date_range_start": r["date_range_start"],
            "date_range_end":   r["date_range_end"],
        }
        try:
            resp = (
                supabase.table("semantic_governance_findings")
                .insert(finding_row)
                .execute()
            )
            finding_rows = resp.data or []
            written += 1
            if finding_rows and r.get("details"):
                _write_finding_evidence(supabase, finding_rows[0]["id"], r["details"])
        except Exception as exc:
            print(
                f"[semantic_governance] WARNING: could not write finding "
                f"'{r.get('check_name', '?')}': {exc}",
                flush=True,
            )

    print(f"[semantic_governance] wrote {written}/{len(results)} findings", flush=True)
    return written


# ── Semantic DQ checks ─────────────────────────────────────────────────────────

def check_ga4_ads_overlap_insufficient(
    config: dict,
    bq_client,
    ga4_tables: list,
) -> dict:
    """L — GA4 history doesn't cover all dates with Ads conversions."""
    if not ga4_tables:
        return _result(
            "ga4_ads_overlap_insufficient", "warning", "medium",
            source_platform="ga4",
            details={"reason": "no GA4 tables available — overlap cannot be computed"},
        )

    earliest_raw = ga4_tables[0].replace("events_", "")
    try:
        earliest_ga4 = date_type(
            int(earliest_raw[:4]), int(earliest_raw[4:6]), int(earliest_raw[6:8])
        )
    except (ValueError, IndexError):
        return _result(
            "ga4_ads_overlap_insufficient", "warning", "medium",
            source_platform="ga4",
            details={"reason": f"cannot parse GA4 table date: {ga4_tables[0]}"},
        )

    stats_table = f"p_ads_CampaignStats_{GOOGLE_ADS_CUSTOMER_ID}"
    query = f"""
        SELECT segments_date, SUM(metrics_conversions) AS total_conversions
        FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{stats_table}`
        WHERE segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
        GROUP BY segments_date
        HAVING total_conversions > 0
        ORDER BY segments_date
    """
    try:
        rows = list(bq_client.query(query).result())
    except Exception as exc:
        return _result(
            "ga4_ads_overlap_insufficient", "warning", "medium",
            source_platform="google_ads",
            details={"reason": f"could not query Ads conversion dates: {exc}"},
        )

    if not rows:
        return _result(
            "ga4_ads_overlap_insufficient", "passed", "low",
            source_platform="google_ads",
            details={"reason": "no Ads conversions in period — overlap check not required"},
        )

    ga4_date_set = set()
    for t in ga4_tables:
        raw = t.replace("events_", "")
        try:
            ga4_date_set.add(date_type(int(raw[:4]), int(raw[4:6]), int(raw[6:8])))
        except (ValueError, IndexError):
            pass

    all_conv_dates = [str(r.segments_date) for r in rows]
    pre_ga4_dates  = [str(r.segments_date) for r in rows if r.segments_date < earliest_ga4]
    overlap_count  = sum(1 for r in rows if r.segments_date in ga4_date_set)
    min_overlap    = config.get("semantic_checks", {}).get(
        "minimum_overlap_days_for_ads_ga4_validation", 3
    )

    if pre_ga4_dates or overlap_count < min_overlap:
        return _result(
            "ga4_ads_overlap_insufficient", "warning", "medium",
            source_platform="google_ads",
            affected_rows=len(pre_ga4_dates),
            details={
                "earliest_ga4_date":       str(earliest_ga4),
                "ads_conversion_dates":    all_conv_dates,
                "pre_ga4_conversion_dates": pre_ga4_dates,
                "overlap_days":            overlap_count,
                "min_required_overlap_days": min_overlap,
            },
        )

    return _result(
        "ga4_ads_overlap_insufficient", "passed", "low",
        source_platform="google_ads",
        details={"earliest_ga4_date": str(earliest_ga4), "overlap_days": overlap_count},
    )


def check_ga4_conversion_registry_mismatch(
    config: dict,
    ga4_summary: Optional[dict],
) -> dict:
    """M — GA4 events that look like conversions but aren't in the registry."""
    if not ga4_summary:
        return _result(
            "ga4_conversion_registry_mismatch", "passed", "low",
            details={"reason": "no GA4 summary available"},
        )

    known_names = _all_registry_names(config)
    top_events  = ga4_summary.get("top_events", [])

    unregistered = []
    for evt in top_events:
        name  = evt.get("event_name", "")
        count = evt.get("count", 0)
        if name in known_names:
            continue
        name_lower = name.lower()
        if any(kw in name_lower for kw in _CONVERSION_KEYWORDS):
            unregistered.append({"event_name": name, "count": count})

    if unregistered:
        return _result(
            "ga4_conversion_registry_mismatch", "warning", "medium",
            source_platform="ga4",
            affected_rows=len(unregistered),
            details={
                "unregistered_conversion_candidates": unregistered,
                "hint": "These events have conversion-like names but are not in conversion_registry.",
            },
        )

    return _result(
        "ga4_conversion_registry_mismatch", "passed", "low",
        source_platform="ga4",
        details={"events_checked": len(top_events)},
    )


def check_ads_conversion_action_not_in_registry(
    config: dict,
    bq_client,
) -> dict:
    """N — Ads conversion actions with conversions > 0 not in the registry.

    Tries ads_AccountConversionStats first (account-wide view), then falls back
    to ads_CampaignConversionStats. Matches by both resource ID
    (segments_conversion_action) and name (segments_conversion_action_name).
    If neither table exists, returns warning/low instead of silently passing.
    """
    reg_names, reg_ids = _registry_ads_actions(config)
    customer_id = config.get("sources", {}).get("google_ads_customer_id", GOOGLE_ADS_CUSTOMER_ID)

    tables_to_try = [
        f"ads_AccountConversionStats_{customer_id}",
        f"ads_CampaignConversionStats_{customer_id}",
    ]

    rows       = None
    used_table = None
    last_error = None

    for table in tables_to_try:
        query = f"""
            SELECT
                segments_conversion_action       AS action_id,
                segments_conversion_action_name  AS action_name,
                SUM(metrics_conversions)         AS total_conversions
            FROM `{GCP_PROJECT_ID}.{GOOGLE_ADS_DATASET}.{table}`
            WHERE segments_date BETWEEN '{DATE_RANGE_START}' AND '{DATE_RANGE_END}'
            GROUP BY action_id, action_name
            HAVING total_conversions > 0
            ORDER BY total_conversions DESC
        """
        try:
            rows = list(bq_client.query(query).result())
            used_table = table
            break
        except Exception as exc:
            last_error = str(exc)
            rows = None

    if rows is None:
        return _result(
            "ads_conversion_action_not_in_registry", "warning", "low",
            source_platform="google_ads",
            details={
                "reason":       "conversion stats tables not found — check skipped",
                "tables_tried": tables_to_try,
                "last_error":   last_error,
            },
        )

    if not rows:
        return _result(
            "ads_conversion_action_not_in_registry", "passed", "low",
            source_platform="google_ads",
            details={"reason": "no conversions recorded in period", "source_table": used_table},
        )

    observed      = []
    unregistered  = []
    for r in rows:
        action_id   = r.action_id   or ""
        action_name = r.action_name or ""
        convs       = float(r.total_conversions)
        entry = {"action_id": action_id, "action_name": action_name, "conversions": convs}
        observed.append(entry)
        registered = action_id in reg_ids or action_name in reg_names
        if not registered:
            unregistered.append(entry)

    registered_actions = [e for e in observed if e not in unregistered]

    if unregistered:
        severity = "high" if any(u["conversions"] >= 10 for u in unregistered) else "medium"
        return _result(
            "ads_conversion_action_not_in_registry", "warning", severity,
            source_platform="google_ads",
            affected_rows=len(unregistered),
            details={
                "unregistered_actions": unregistered,
                "registered_actions":   registered_actions,
                "source_table":         used_table,
            },
        )

    return _result(
        "ads_conversion_action_not_in_registry", "passed", "low",
        source_platform="google_ads",
        details={
            "all_actions_registered": True,
            "registered_actions":     registered_actions,
            "source_table":           used_table,
        },
    )


def check_ads_conversion_action_semantic_review_required(config: dict) -> dict:
    """O — Conversion actions mapped but flagged as technical alias or needing semantic review."""
    review_actions = _review_required_actions(config)
    if not review_actions:
        return _result(
            "ads_conversion_action_semantic_review_required", "passed", "low",
            source_platform="google_ads",
            details={"reason": "no actions requiring semantic review in registry"},
        )

    flagged = [
        {
            "event_name":    e.get("event_name"),
            "type":          e.get("type"),
            "status":        e.get("status"),
            "ads_action":    e.get("ads_conversion_action", {}).get("name"),
            "ads_action_id": e.get("ads_conversion_action", {}).get("id"),
            "notes":         e.get("notes"),
        }
        for e in review_actions
    ]
    return _result(
        "ads_conversion_action_semantic_review_required", "warning", "medium",
        source_platform="google_ads",
        affected_rows=len(flagged),
        details={"flagged_actions": flagged},
    )


def check_ga4_non_production_traffic_detected(
    config: dict,
    ga4_summary: Optional[dict],
) -> dict:
    """P — page_location URLs from non-production environments.

    Uses classify_url_environment() to bucket each URL. Any bucket other than
    'production' or 'unknown' is reported with a per-environment breakdown.
    Priority: debug → local → staging → preview → production → unknown.
    """
    if not ga4_summary:
        return _result(
            "ga4_non_production_traffic_detected", "passed", "low",
            details={"reason": "no GA4 summary available"},
        )

    domains_cfg = config.get("domains", {})
    top_pages   = ga4_summary.get("top_landing_pages", [])

    env_pages: dict = {}
    for page in top_pages:
        url = page.get("page_location", "")
        env = classify_url_environment(url, domains_cfg)
        if env in ("production", "unknown"):
            continue
        env_pages.setdefault(env, []).append({
            "environment": env,
            "url":         _redact_gclid(url[:120]),
            "views":       page.get("views", 0),
        })

    if env_pages:
        total = sum(len(v) for v in env_pages.values())
        return _result(
            "ga4_non_production_traffic_detected", "warning", "medium",
            source_platform="ga4",
            affected_rows=total,
            details={
                "environment_breakdown": env_pages,
                "summary":               {k: len(v) for k, v in env_pages.items()},
                "pages_scanned":         len(top_pages),
            },
        )

    return _result(
        "ga4_non_production_traffic_detected", "passed", "low",
        source_platform="ga4",
        details={"pages_scanned": len(top_pages)},
    )


def check_ga4_suspicious_event_names_detected(
    config: dict,
    ga4_summary: Optional[dict],
) -> dict:
    """Q — GA4 events explicitly listed as suspicious in config."""
    if not ga4_summary:
        return _result(
            "ga4_suspicious_event_names_detected", "passed", "low",
            details={"reason": "no GA4 summary available"},
        )

    suspicious_cfg = {
        e["event_name"]: e.get("reason", "")
        for e in config.get("suspicious_events", [])
        if "event_name" in e
    }
    if not suspicious_cfg:
        return _result(
            "ga4_suspicious_event_names_detected", "passed", "low",
            details={"reason": "no suspicious events configured"},
        )

    event_counts = {
        e["event_name"]: e["count"]
        for e in ga4_summary.get("top_events", [])
    }

    found = []
    for name, reason in suspicious_cfg.items():
        count = event_counts.get(name, 0)
        if count > 0:
            found.append({"event_name": name, "count": count, "reason": reason})

    if found:
        return _result(
            "ga4_suspicious_event_names_detected", "warning", "medium",
            source_platform="ga4",
            affected_rows=len(found),
            details={"suspicious_events_found": found},
        )

    return _result(
        "ga4_suspicious_event_names_detected", "passed", "low",
        source_platform="ga4",
        details={"suspicious_events_checked": list(suspicious_cfg.keys())},
    )


def check_paid_sessions_without_funnel_progress(
    config: dict,
    bq_client,
    ga4_dataset: str,
    ga4_tables: list,
) -> dict:
    """R — paid sessions with no intent/intermediate/conversion event."""
    if not bq_client or not ga4_tables or not ga4_dataset:
        return _result(
            "paid_sessions_without_funnel_progress", "passed", "low",
            source_platform="ga4",
            details={"reason": "GA4 not available — check skipped"},
        )

    funnel_names = _dedupe_preserve_order(_funnel_event_names(config))
    if not funnel_names:
        return _result(
            "paid_sessions_without_funnel_progress", "passed", "low",
            source_platform="ga4",
            details={"reason": "no funnel events configured"},
        )

    wildcard = f"`{GCP_PROJECT_ID}.{ga4_dataset}.events_*`"
    funnel_sql = _safe_sql_list(funnel_names)

    query = f"""
        WITH paid_views AS (
            SELECT
                user_pseudo_id,
                (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id
            FROM {wildcard}
            WHERE _TABLE_SUFFIX BETWEEN '{_DATE_START_SUFFIX}' AND '{_DATE_END_SUFFIX}'
              AND event_name = 'page_view'
              AND EXISTS (
                  SELECT 1 FROM UNNEST(event_params) ep
                  WHERE ep.key = 'page_location'
                    AND (
                        ep.value.string_value LIKE '%gclid=%'
                        OR ep.value.string_value LIKE '%campaign_id=%'
                        OR ep.value.string_value LIKE '%adgroup_id=%'
                    )
              )
        ),
        funnel_hits AS (
            SELECT
                user_pseudo_id,
                (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id
            FROM {wildcard}
            WHERE _TABLE_SUFFIX BETWEEN '{_DATE_START_SUFFIX}' AND '{_DATE_END_SUFFIX}'
              AND event_name IN ({funnel_sql})
        )
        SELECT
            COUNT(DISTINCT CONCAT(p.user_pseudo_id, CAST(IFNULL(p.session_id, 0) AS STRING)))
                AS paid_sessions,
            COUNT(DISTINCT CASE
                WHEN f.user_pseudo_id IS NOT NULL
                THEN CONCAT(p.user_pseudo_id, CAST(IFNULL(p.session_id, 0) AS STRING))
                ELSE NULL END)
                AS paid_with_progress
        FROM paid_views p
        LEFT JOIN funnel_hits f
            ON p.user_pseudo_id = f.user_pseudo_id
            AND p.session_id    = f.session_id
    """
    try:
        rows = list(bq_client.query(query).result())
    except Exception as exc:
        return _result(
            "paid_sessions_without_funnel_progress", "warning", "medium",
            source_platform="ga4",
            details={"reason": f"BQ query error: {exc}"},
        )

    if not rows:
        return _result(
            "paid_sessions_without_funnel_progress", "passed", "low",
            source_platform="ga4",
            details={"reason": "no rows returned from BQ"},
        )

    paid_sessions  = int(rows[0].paid_sessions)
    with_progress  = int(rows[0].paid_with_progress)
    without_progress = paid_sessions - with_progress

    if paid_sessions > 0 and with_progress == 0:
        return _result(
            "paid_sessions_without_funnel_progress", "warning", "medium",
            source_platform="ga4",
            affected_rows=paid_sessions,
            metric_value=float(paid_sessions),
            threshold_value=0.0,
            details={
                "paid_sessions":             paid_sessions,
                "paid_sessions_with_progress": with_progress,
                "paid_sessions_without_progress": without_progress,
                "funnel_events_checked":     funnel_names,
            },
        )

    return _result(
        "paid_sessions_without_funnel_progress", "passed", "low",
        source_platform="ga4",
        affected_rows=0,
        details={"paid_sessions": paid_sessions, "with_progress": with_progress},
    )


def check_utm_campaign_empty_in_paid_urls(
    config: dict,
    bq_client,
    ga4_dataset: str,
    ga4_tables: list,
) -> dict:
    """S — paid page_view URLs missing required attribution parameters.

    Checks all params in attribution.required_paid_url_params dynamically.
    Each param is validated against _PARAM_ALLOWLIST_RE before SQL interpolation.
    LOWER() is applied to page_location for case-insensitive matching.
    """
    if not bq_client or not ga4_tables or not ga4_dataset:
        return _result(
            "utm_campaign_empty_in_paid_urls", "passed", "low",
            source_platform="ga4",
            details={"reason": "GA4 not available — check skipped"},
        )

    raw_params = config.get("attribution", {}).get("required_paid_url_params", [
        "gclid", "utm_source", "utm_medium", "utm_campaign",
        "campaign_id", "adgroup_id", "utm_content",
    ])

    params   = [p for p in raw_params if _PARAM_ALLOWLIST_RE.match(str(p))]
    rejected = [p for p in raw_params if not _PARAM_ALLOWLIST_RE.match(str(p))]
    if rejected:
        print(
            f"[semantic_governance] check S: rejected invalid param names: {rejected}",
            flush=True,
        )
    if not params:
        return _result(
            "utm_campaign_empty_in_paid_urls", "passed", "low",
            source_platform="ga4",
            details={"reason": "no valid attribution params configured"},
        )

    wildcard = f"`{GCP_PROJECT_ID}.{ga4_dataset}.events_*`"

    # Each COUNTIF uses the already-lowercased page_location from the CTE
    countif_parts = [
        f"    COUNTIF(REGEXP_CONTAINS(page_location, r'[?&]{p}=[^&]+')) AS has_{p}"
        for p in params
    ]
    countif_cols = ",\n".join(countif_parts)

    query = f"""
        WITH paid_views AS (
            SELECT LOWER(
                (SELECT ep.value.string_value
                 FROM UNNEST(event_params) ep
                 WHERE ep.key = 'page_location' LIMIT 1)
            ) AS page_location
            FROM {wildcard}
            WHERE _TABLE_SUFFIX BETWEEN '{_DATE_START_SUFFIX}' AND '{_DATE_END_SUFFIX}'
              AND event_name = 'page_view'
              AND EXISTS (
                  SELECT 1 FROM UNNEST(event_params) ep
                  WHERE ep.key = 'page_location'
                    AND (
                        LOWER(ep.value.string_value) LIKE '%gclid=%'
                        OR LOWER(ep.value.string_value) LIKE '%campaign_id=%'
                        OR LOWER(ep.value.string_value) LIKE '%adgroup_id=%'
                    )
              )
        )
        SELECT
            COUNT(*) AS total_paid_views,
{countif_cols}
        FROM paid_views
        WHERE page_location IS NOT NULL
    """
    try:
        rows = list(bq_client.query(query).result())
    except Exception as exc:
        return _result(
            "utm_campaign_empty_in_paid_urls", "warning", "medium",
            source_platform="ga4",
            details={"reason": f"BQ query error: {exc}"},
        )

    if not rows:
        return _result(
            "utm_campaign_empty_in_paid_urls", "passed", "low",
            source_platform="ga4",
            details={"total_paid_views": 0},
        )

    row   = rows[0]
    total = int(row.total_paid_views)

    param_coverage: dict = {}
    missing_params: list = []
    for p in params:
        present = int(getattr(row, f"has_{p}", 0))
        missing = total - present
        pct     = round(present / total * 100, 1) if total > 0 else 100.0
        param_coverage[p] = {"present": present, "missing": missing, "pct_present": pct}
        if missing > 0:
            missing_params.append(p)

    if missing_params:
        return _result(
            "utm_campaign_empty_in_paid_urls", "warning", "medium",
            source_platform="ga4",
            affected_rows=total,
            metric_value=float(len(missing_params)),
            threshold_value=0.0,
            details={
                "total_paid_views": total,
                "param_coverage":   param_coverage,
                "missing_params":   missing_params,
                "rejected_params":  rejected or None,
            },
        )

    return _result(
        "utm_campaign_empty_in_paid_urls", "passed", "low",
        source_platform="ga4",
        details={
            "total_paid_views": total,
            "param_coverage":   param_coverage,
        },
    )


# ── Orchestration ──────────────────────────────────────────────────────────────

def run_semantic_quality_checks(
    config: dict,
    supabase,
    bq_client,
    ga4_dataset: str,
    ga4_tables: list,
    ga4_summary: Optional[dict],
    dry_run: bool = False,
) -> list:
    """Run all semantic governance checks and persist results.

    Returns list of result dicts (same shape as data_quality checks).
    Persistence is best-effort — pipeline continues on any Supabase error.
    Individual check errors are caught internally; technical failures raise.
    """
    tenant = config.get("tenant", {})
    print(
        f"[semantic_governance] running checks for tenant='{tenant.get('slug', '?')}' "
        f"period={DATE_RANGE_START}..{DATE_RANGE_END}",
        flush=True,
    )

    run_id = start_governance_run(supabase, config, dry_run=dry_run)

    results = []
    checks = [
        lambda: check_ga4_ads_overlap_insufficient(config, bq_client, ga4_tables),
        lambda: check_ga4_conversion_registry_mismatch(config, ga4_summary),
        lambda: check_ads_conversion_action_not_in_registry(config, bq_client),
        lambda: check_ads_conversion_action_semantic_review_required(config),
        lambda: check_ga4_non_production_traffic_detected(config, ga4_summary),
        lambda: check_ga4_suspicious_event_names_detected(config, ga4_summary),
        lambda: check_paid_sessions_without_funnel_progress(
            config, bq_client, ga4_dataset, ga4_tables
        ),
        lambda: check_utm_campaign_empty_in_paid_urls(
            config, bq_client, ga4_dataset, ga4_tables
        ),
    ]

    for fn in checks:
        r = fn()
        print(
            f"[semantic_governance] {r['check_name']}: {r['status']} "
            f"affected_rows={r['affected_rows']}",
            flush=True,
        )
        results.append(r)

    write_governance_findings(supabase, run_id, results, dry_run=dry_run)
    finish_governance_run(supabase, run_id, results, dry_run=dry_run)

    return results


# ── Semantic insight generation ────────────────────────────────────────────────

def generate_semantic_insights(
    config: dict,
    semantic_dq_results: list,
) -> list:
    """
    Generate semantic insights from the DQ check results produced by
    run_semantic_quality_checks().  Only fires when the corresponding check
    has status='warning' or status='failed'.
    """
    by_name = {r["check_name"]: r for r in semantic_dq_results}
    insights = []

    # ── 1. ga4_ads_overlap_insufficient ───────────────────────────────────────
    chk = by_name.get("ga4_ads_overlap_insufficient")
    if chk and chk["status"] == "warning":
        det = chk.get("details") or {}
        insights.append(_insight(
            insight_type   = "ga4_ads_overlap_insufficient",
            severity       = "medium",
            title          = "GA4 ainda não valida o histórico de conversões do Google Ads",
            summary        = (
                "As conversões do Google Ads ocorreram antes do início do histórico GA4 "
                "exportado para BigQuery. Não há sobreposição suficiente para auditar "
                "essas conversões no GA4."
            ),
            recommendation = (
                "Aguardar nova janela com sobreposição Ads + GA4 antes de concluir "
                "divergência de conversão."
            ),
            evidence       = {
                "earliest_ga4_date":       det.get("earliest_ga4_date"),
                "ads_conversion_dates":    det.get("ads_conversion_dates", []),
                "pre_ga4_conversion_dates": det.get("pre_ga4_conversion_dates", []),
                "overlap_days":            det.get("overlap_days", 0),
                "min_required_overlap_days": det.get("min_required_overlap_days", 3),
                "date_range_start":        str(DATE_RANGE_START),
                "date_range_end":          str(DATE_RANGE_END),
            },
            source_tables  = ["campaign_summary", "ga4_first_light_summary"],
            confidence     = 0.85,
            dedupe_key     = "ga4_ads_overlap_insufficient",
        ))

    # ── 2. ads_conversion_action_semantic_review_required ─────────────────────
    chk = by_name.get("ads_conversion_action_semantic_review_required")
    if chk and chk["status"] == "warning":
        det = chk.get("details") or {}
        flagged = det.get("flagged_actions", [])
        action_names = [f.get("ads_action") or f.get("event_name") for f in flagged]
        insights.append(_insight(
            insight_type   = "ads_conversion_action_semantic_review_required",
            severity       = "medium",
            title          = "Ação de conversão do Ads exige validação semântica",
            summary        = (
                "O Google Ads está otimizando para "
                + ", ".join(n for n in action_names if n)
                + ", que parece ser um evento técnico associado ao sucesso de cadastro."
            ),
            recommendation = (
                "Validar se o evento é conversão canônica ou alias técnico. "
                "Revisar o mapeamento no Growth Measurement Playbook antes de "
                "tomar decisões de otimização de campanha com base nessa ação."
            ),
            evidence       = {
                "flagged_actions":  flagged,
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["campaign_summary"],
            confidence     = 0.90,
            dedupe_key     = "ads_conv_semantic_review_required",
        ))

    # ── 3. paid_sessions_without_funnel_progress ──────────────────────────────
    chk = by_name.get("paid_sessions_without_funnel_progress")
    if chk and chk["status"] == "warning":
        det = chk.get("details") or {}
        paid = det.get("paid_sessions", chk.get("affected_rows", 0))
        insights.append(_insight(
            insight_type   = "paid_sessions_without_funnel_progress",
            severity       = "medium",
            title          = "Sessões pagas chegaram ao GA4, mas não avançaram no funil",
            summary        = (
                f"{paid} sessão(ões) paga(s) detectada(s) no período chegaram à "
                "página, mas não geraram eventos de intenção, ativação ou conversão."
            ),
            recommendation = (
                "Monitorar mais dias de sobreposição antes de concluir performance. "
                "Revisar landing, oferta e eventos de intenção configurados no GTM."
            ),
            evidence       = {
                "paid_sessions":             paid,
                "paid_sessions_with_progress": det.get("paid_sessions_with_progress", 0),
                "funnel_events_checked":     det.get("funnel_events_checked", []),
                "date_range_start":          str(DATE_RANGE_START),
                "date_range_end":            str(DATE_RANGE_END),
            },
            source_tables  = ["ga4_first_light_summary"],
            confidence     = 0.80,
            dedupe_key     = "paid_sessions_no_funnel_progress",
        ))

    # ── 4. utm_campaign_empty_in_paid_urls ────────────────────────────────────
    chk = by_name.get("utm_campaign_empty_in_paid_urls")
    if chk and chk["status"] == "warning":
        det = chk.get("details") or {}
        count = det.get("paid_views_without_utm_campaign", chk.get("affected_rows", 0))
        insights.append(_insight(
            insight_type   = "utm_campaign_empty_in_paid_urls",
            severity       = "medium",
            title          = "UTM campaign ausente em URLs pagas",
            summary        = (
                f"Foram detectadas {count} visualização(ões) de página de Google Ads "
                "com gclid e campaign_id, mas sem utm_campaign preenchido."
            ),
            recommendation = (
                "Padronizar UTMs conforme o Growth Measurement Playbook para "
                "melhorar leitura por campanha no GA4 e atribuição de canais."
            ),
            evidence       = {
                "paid_views_without_utm_campaign": count,
                "date_range_start": str(DATE_RANGE_START),
                "date_range_end":   str(DATE_RANGE_END),
            },
            source_tables  = ["ga4_first_light_summary"],
            confidence     = 0.85,
            dedupe_key     = "utm_campaign_empty_paid",
        ))

    return insights
