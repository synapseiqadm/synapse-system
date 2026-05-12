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
from dotenv import load_dotenv

# ── Bootstrap: inject a fake config module so ai_narrative doesn't require .env ─
_mock_config = types.ModuleType("config")
_mock_config.GCP_PROJECT_ID = "synapsesystem"
sys.modules.setdefault("config", _mock_config)

_CONNECTORS_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "connectors"))
if _CONNECTORS_DIR not in sys.path:
    sys.path.insert(0, _CONNECTORS_DIR)

# Load backend/.env before importing ai_narrative so GEMINI_API_KEY is in os.environ
# at module-level capture time (GEMINI_API_KEY = os.getenv(...) runs on import).
_ENV_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".env"))
load_dotenv(_ENV_PATH, override=False)

import ai_narrative  # noqa: E402  — must follow path setup and load_dotenv
from google import genai as _genai_sdk  # noqa: F401 — imported to allow patching

# ── Simulated payload ─────────────────────────────────────────────────────────
# Represents plausible output from fn_campaign_snapshot_delta()
# for Woke People on a day with mixed campaign signals.
#
# HIGH-RESOLUTION patterns (CTR and CPC present in input):
#   Pattern A: CPA↑(CRITICAL) + CTR↓ + CPC≈ → Creative/ad fatigue
#   Pattern B: Conversions↑(CRITICAL) + CPA↓ + CTR↑ + CPC↓ → Virtuous cycle
#
# Validation criterion: technical_diagnosis MUST cite CTR or CPC explicitly.
SIMULATED_SNAPSHOT = [
    # ── Campaign A: Woke | Conscientização | Agosto ─────────────────────────
    # CPA↑(CRITICAL) + CTR↓(SIGNIFICANT) + CPC≈ → creative fatigue
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
        "metric_name":      "clicks",
        "value_now":        253.00,
        "value_then":       214.00,
        "delta_percentage": 18.22,
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
    {
        "campaign_name":    "Woke | Conscientização | Agosto",
        "metric_name":      "ctr",
        "value_now":        2.18,
        "value_then":       3.35,
        "delta_percentage": -34.93,
        "impact_level":     "SIGNIFICANT",
    },
    # ── Campaign B: Woke | Remarketing | Sempre Ativo ───────────────────────
    # CPC↓(SIGNIFICANT) + CTR↑(SIGNIFICANT) + Conversions↑(CRITICAL) → virtuous cycle
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
        "metric_name":      "clicks",
        "value_now":        400.00,
        "value_then":       257.00,
        "delta_percentage": 55.64,
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
    {
        "campaign_name":    "Woke | Remarketing | Sempre Ativo",
        "metric_name":      "ctr",
        "value_now":        5.12,
        "value_then":       3.68,
        "delta_percentage": 39.13,
        "impact_level":     "SIGNIFICANT",
    },
    {
        "campaign_name":    "Woke | Remarketing | Sempre Ativo",
        "metric_name":      "cpc",
        "value_now":        1.35,
        "value_then":       1.98,
        "delta_percentage": -31.82,
        "impact_level":     "SIGNIFICANT",
    },
]

# Captured mock response — reflects what Gemini returns for the HIGH-RESOLUTION payload above.
# Used when GEMINI_API_KEY is absent; also serves as regression reference.
# Validation: technical_diagnosis MUST cite CTR (34.93% drop) and CPC (R$1.98→R$1.35).
_MOCK_GEMINI_RESPONSE = {
    "insight_summary": (
        "CPA +100% em 'Conscientização | Agosto': CTR caiu 35% — fadiga criativa crítica."
    ),
    "technical_diagnosis": (
        "Campaign 'Woke | Conscientização | Agosto' matches the CPA↑+CTR↓+CPC≈ pattern: "
        "spend rose 27.55% (R$980→R$1,250) while CTR fell 34.93% (3.35%→2.18%) and CPC remained stable "
        "— ads are shown more but clicked less, cutting conversion shots and driving CPA from R$44.55 "
        "to R$89.29 (+100.43%, CRITICAL). 'Remarketing | Sempre Ativo' shows the opposite virtuous cycle: "
        "CPC down 31.82% (R$1.98→R$1.35) with CTR up 39.13% (3.68%→5.12%) and conversions +72.22%, "
        "confirming budget reallocation opportunity."
    ),
    "recommended_action": (
        "Substituir os criativos de 'Conscientização | Agosto' imediatamente (testar ao menos "
        "3 variações de headline/visual para recuperar CTR acima de 3%) e redirecionar 15–20% "
        "do budget para 'Remarketing | Sempre Ativo', que apresenta ciclo virtuoso com CPC em queda "
        "e CTR crescente."
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
                result = ai_narrative.generate_narrative(
                    SIMULATED_SNAPSHOT, is_simulated=True
                )
            finally:
                ai_narrative.GEMINI_API_KEY = original_key

        self.assertTrue(result["is_simulated"])
        self.assertTrue(result["insight_summary"].startswith("[PREVIEW DE TESTE] "))
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
        self.assertIn("is_simulated",        result)
        self.assertIn("_meta",               result)
        self.assertIsInstance(result["priority_score"], int)
        self.assertIn(result["priority_score"], range(1, 6))
        self.assertIsInstance(result["insight_summary"], str)
        self.assertIsInstance(result["is_simulated"], bool)
        # Strip [PREVIEW DE TESTE] prefix before checking the 100-char body limit.
        body = result["insight_summary"]
        if body.startswith("[PREVIEW DE TESTE] "):
            body = body[len("[PREVIEW DE TESTE] "):]
        self.assertLessEqual(len(body), 100)

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
