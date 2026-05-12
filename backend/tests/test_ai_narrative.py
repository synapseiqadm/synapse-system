"""
test_ai_narrative.py — SynapseIQ v1.9.2
Sandbox validation for the Gemini narrative generator.

Modes:
  Live  — GEMINI_API_KEY present in env → real Gemini API call
  Mock  — GEMINI_API_KEY absent         → mocked response, always runs

Run (from repo root):
    D:\\dev\\synapse\\.venv\\Scripts\\python.exe -m pytest backend/tests/test_ai_narrative.py -v -s
"""

import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# ── Bootstrap: inject a fake config module so ai_narrative doesn't require .env ─
_mock_config = types.ModuleType("config")
_mock_config.GCP_PROJECT_ID = "synapsesystem"
sys.modules.setdefault("config", _mock_config)

_CONNECTORS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "connectors"))
if _CONNECTORS_DIR not in sys.path:
    sys.path.insert(0, _CONNECTORS_DIR)

import ai_narrative  # noqa: E402  — must follow path setup
from google import genai as _genai_sdk  # noqa: F401 — imported to allow patching

# ── Simulated payload ─────────────────────────────────────────────────────────
# Represents plausible output from fn_campaign_snapshot_delta()
# for Woke People on a day with mixed campaign signals.
# Pattern A: Spend↑ + Conversions↓ + CPA CRITICAL → audience saturation
# Pattern B: Spend≈ + Conversions↑ + CPA↓        → remarketing optimization
SIMULATED_SNAPSHOT = [
    # ── Campaign A: Woke | Conscientização | Agosto ─────────────────────────
    {
        "campaign_name":    "Woke | Conscientização | Agosto",
        "metric_name":      "spend",
        "value_now":        1250.00,
        "value_then":       980.00,
        "delta_percentage": 27.55,
        "impact_level":     "SIGNIFICANT",
    },
    {
        "campaign_name":    "Woke | Conscientização | Agosto",
        "metric_name":      "conversions",
        "value_now":        14.00,
        "value_then":       22.00,
        "delta_percentage": -36.36,
        "impact_level":     "SIGNIFICANT",
    },
    {
        "campaign_name":    "Woke | Conscientização | Agosto",
        "metric_name":      "cpa",
        "value_now":        89.29,
        "value_then":       44.55,
        "delta_percentage": 100.43,
        "impact_level":     "CRITICAL",
    },
    # ── Campaign B: Woke | Remarketing | Sempre Ativo ───────────────────────
    {
        "campaign_name":    "Woke | Remarketing | Sempre Ativo",
        "metric_name":      "conversions",
        "value_now":        31.00,
        "value_then":       18.00,
        "delta_percentage": 72.22,
        "impact_level":     "CRITICAL",
    },
    {
        "campaign_name":    "Woke | Remarketing | Sempre Ativo",
        "metric_name":      "cpa",
        "value_now":        17.42,
        "value_then":       28.33,
        "delta_percentage": -38.51,
        "impact_level":     "SIGNIFICANT",
    },
]

# Captured mock response — reflects what Gemini returns for the payload above.
# Used when GEMINI_API_KEY is absent; also serves as regression reference.
_MOCK_GEMINI_RESPONSE = {
    "insight_summary": (
        "CPA +100% em 'Conscientização | Agosto' com spend crescente — "
        "colapso crítico de eficiência."
    ),
    "technical_diagnosis": (
        "Campaign 'Woke | Conscientização | Agosto' increased spend 27.55% (R$980→R$1,250) "
        "while conversions fell 36.36% (22→14), driving CPA from R$44.55 to R$89.29 (+100.43%, CRITICAL). "
        "Pattern: Spend↑ + Conversions↓ → audience saturation; the budget increment is reaching "
        "low-intent users. Remarketing shows the inverse: +72.22% conversions with CPA down 38.51% — "
        "a healthy signal that warrants budget reallocation."
    ),
    "recommended_action": (
        "Pausar o incremento de budget em 'Conscientização | Agosto' imediatamente e redirecionar "
        "15-20% do investimento para 'Remarketing | Sempre Ativo', que demonstra eficiência crescente. "
        "Revisar segmentação de audiência e excluir convertidos recentes da campanha de conscientização."
    ),
    "priority_score": 5,
}


class TestAINarrative(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.live = bool(os.getenv("GEMINI_API_KEY", ""))
        mode = "LIVE" if cls.live else "MOCK"
        print(f"\n[sandbox] Running in {mode} mode.", flush=True)

    # ── Live test ────────────────────────────────────────────────────────────

    def test_live_api_call(self):
        """Call the real Gemini API. Skipped when GEMINI_API_KEY is absent."""
        if not self.live:
            self.skipTest("GEMINI_API_KEY not configured — skipping live call.")

        result = ai_narrative.generate_narrative(SIMULATED_SNAPSHOT)
        self._assert_schema(result)
        self._print_exchange(result, mode="LIVE")

    # ── Mock test ────────────────────────────────────────────────────────────

    def test_mock_pipeline(self):
        """
        Validate the full pipeline (message building, JSON parsing, schema enforcement)
        using a mocked Gemini response. Always runs.
        """
        mock_response = MagicMock()
        mock_response.text = json.dumps(_MOCK_GEMINI_RESPONSE)

        with patch("google.genai.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            original_key = ai_narrative.GEMINI_API_KEY
            ai_narrative.GEMINI_API_KEY = "mock-key-for-test"
            try:
                result = ai_narrative.generate_narrative(SIMULATED_SNAPSHOT)
            finally:
                ai_narrative.GEMINI_API_KEY = original_key

        self._assert_schema(result)
        self._print_exchange(result, mode="MOCK")

    def test_missing_api_key_raises(self):
        """EnvironmentError when GEMINI_API_KEY is empty."""
        original_key = ai_narrative.GEMINI_API_KEY
        ai_narrative.GEMINI_API_KEY = ""
        try:
            with self.assertRaises(EnvironmentError):
                ai_narrative.generate_narrative(SIMULATED_SNAPSHOT)
        finally:
            ai_narrative.GEMINI_API_KEY = original_key

    def test_invalid_json_raises(self):
        """ValueError when model returns non-JSON text."""
        mock_response = MagicMock()
        mock_response.text = "I cannot analyze this data."

        with patch("google.genai.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            original_key = ai_narrative.GEMINI_API_KEY
            ai_narrative.GEMINI_API_KEY = "mock-key-for-test"
            try:
                with self.assertRaises(ValueError):
                    ai_narrative.generate_narrative(SIMULATED_SNAPSHOT)
            finally:
                ai_narrative.GEMINI_API_KEY = original_key

    def test_missing_field_raises(self):
        """KeyError when model returns JSON with a missing required field."""
        incomplete = {k: v for k, v in _MOCK_GEMINI_RESPONSE.items()
                      if k != "recommended_action"}
        mock_response = MagicMock()
        mock_response.text = json.dumps(incomplete)

        with patch("google.genai.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            mock_client_cls.return_value = mock_client

            original_key = ai_narrative.GEMINI_API_KEY
            ai_narrative.GEMINI_API_KEY = "mock-key-for-test"
            try:
                with self.assertRaises(KeyError):
                    ai_narrative.generate_narrative(SIMULATED_SNAPSHOT)
            finally:
                ai_narrative.GEMINI_API_KEY = original_key

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _assert_schema(self, result: dict) -> None:
        self.assertIn("insight_summary",    result)
        self.assertIn("technical_diagnosis", result)
        self.assertIn("recommended_action",  result)
        self.assertIn("priority_score",      result)
        self.assertIn("_meta",               result)
        self.assertIsInstance(result["priority_score"], int)
        self.assertIn(result["priority_score"], range(1, 6))
        self.assertIsInstance(result["insight_summary"], str)
        self.assertLessEqual(len(result["insight_summary"]), 120)

    def _print_exchange(self, result: dict, mode: str) -> None:
        div = "-" * 60
        print(f"\n{div}")
        print(f"[{mode}] INPUT -- Simulated snapshot ({len(SIMULATED_SNAPSHOT)} rows)")
        print(div)
        print(json.dumps(SIMULATED_SNAPSHOT, indent=2, ensure_ascii=True))
        print(f"\n{div}")
        print(f"[{mode}] OUTPUT -- Gemini diagnostic")
        print(div)
        display = {k: v for k, v in result.items() if k != "_meta"}
        print(json.dumps(display, indent=2, ensure_ascii=True))
        print(f"\n[{mode}] meta: {result.get('_meta')}")
        print(div)


if __name__ == "__main__":
    unittest.main(verbosity=2)
