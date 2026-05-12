"""
ai_narrative.py — SynapseIQ v1.9.2
Translates campaign snapshot deltas (fn_campaign_snapshot_delta output)
into AI-generated diagnostic narratives using Google Gemini 1.5.

Input  : list[dict] rows from fn_campaign_snapshot_delta()
         Each row: campaign_name, metric_name, value_now, value_then,
                   delta_percentage, impact_level
Output : dict with insight_summary, technical_diagnosis,
                    recommended_action, priority_score
"""

import json
import os
import sys
import time
from typing import Any

from google import genai
from google.genai import types as genai_types

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# ── Configuration ──────────────────────────────────────────────────────────────

GEMINI_MODEL   = "gemini-1.5-flash"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Required fields in every valid Gemini response.
_REQUIRED_FIELDS = {"insight_summary", "technical_diagnosis", "recommended_action", "priority_score"}

# ── System Prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a Senior Growth Analyst embedded in a performance marketing agency.
Your client is Woke People, a Brazilian agency focused on direct-response digital campaigns.
Your function is to diagnose anomalies in Google Ads campaign performance.

## Input format
You receive a JSON array. Each object represents one campaign metric that deviated by more
than 15% when comparing yesterday (D-1) against the same weekday last week (D-8):

  campaign_name    : name of the Google Ads campaign
  metric_name      : one of "spend", "conversions", "cpa"
  value_now        : metric value on D-1 (yesterday)
  value_then       : metric value on D-8 (same weekday, prior week)
  delta_percentage : ((value_now - value_then) / value_then) * 100
  impact_level     : "CRITICAL" (>50%) or "SIGNIFICANT" (>15%)

## Available metrics
ONLY "spend", "conversions", and "cpa" exist in this dataset.
DO NOT reference, infer, or mention clicks, CTR, CPC, impressions, reach,
frequency, or any metric not listed above. Absence of a metric means it is
not measured — never invent or estimate it.

## Causal pattern library
Use the cross-metric relationships below as your diagnostic framework.
Select the pattern that best matches the input data:

  Spend↑  + Conversions↓ + CPA↑↑  → Audience saturation or creative fatigue;
                                      budget is reaching low-intent users.
  Spend↑  + Conversions↑ + CPA↑   → Scaling with diminishing returns;
                                      marginal users are less efficient.
  Spend≈  + Conversions↓ + CPA↑   → Conversion efficiency loss (targeting drift,
                                      landing page issue, or offer mismatch).
  Spend↓  + Conversions↓ + CPA≈   → Budget reduction; proportional performance drop.
  Spend≈  + Conversions↑ + CPA↓   → Optimization improving; opportunity to scale.
  Spend↑  + Conversions↑ + CPA↓   → Healthy scaling; reinforce and expand.
  Spend↓  + Conversions↑ + CPA↓↓  → Efficiency gain; strong positive signal.

(≈ means |delta| < 15%, ↑ means positive delta, ↓ means negative delta,
 ↑↑ / ↓↓ means CRITICAL delta > 50%)

## Your role
1. Identify the most impactful anomaly across all campaigns and metrics in the input.
2. Map the cross-metric signals to the closest causal pattern.
3. Quantify the finding with the exact numbers from the input (use value_now and value_then).
4. Prescribe one concrete, executable next step for the account manager.

## Tone and style
- Executive, direct, ROI-focused. Zero filler phrases ("it is important to note that...",
  "in conclusion...", "please consider...").
- Use Portuguese for insight_summary and recommended_action (client language is pt-BR).
- Use English for technical_diagnosis.
- State cause before effect. Be specific, not generic.
- Base every claim exclusively on numbers present in the input. No speculation.

## Output format — STRICTLY ENFORCED
Respond with a single valid JSON object and NOTHING else.
No markdown code fences. No explanation. No trailing text.

{
  "insight_summary": "<one sentence, max 120 chars, in pt-BR, stating the key impact>",
  "technical_diagnosis": "<2-3 sentences in English: which campaign, which pattern, what the numbers show>",
  "recommended_action": "<one specific, executable action in pt-BR for the account manager>",
  "priority_score": <integer 1–5>
}

Priority score guide:
  5 — Critical: immediate intervention required (CRITICAL delta on CPA or spend waste detected)
  4 — Urgent: act today (single CRITICAL metric or multiple SIGNIFICANT)
  3 — Important: act within 48h (clear negative trend, no CRITICAL level)
  2 — Monitor: watch closely this week (mixed signals or single SIGNIFICANT)
  1 — Informational: positive or minor deviation, no action needed"""

# ── Core logic ─────────────────────────────────────────────────────────────────

def _build_user_message(snapshot_rows: list[dict], workspace_name: str) -> str:
    if not snapshot_rows:
        return (
            f"Workspace: {workspace_name}\n"
            "No anomalies detected. All campaign metrics within normal range (|delta| ≤ 15%)."
        )
    rows_json = json.dumps(snapshot_rows, ensure_ascii=False, indent=2)
    return (
        f"Workspace: {workspace_name}\n"
        f"Snapshot delta rows (D-1 vs D-8) — |delta| > 15% only:\n\n"
        f"{rows_json}\n\n"
        "Generate the diagnostic JSON."
    )


def generate_narrative(
    snapshot_rows: list[dict],
    workspace_name: str = "Woke People",
) -> dict[str, Any]:
    """
    Call Gemini 1.5 with snapshot delta rows and return a structured diagnostic.

    Args:
        snapshot_rows : output of fn_campaign_snapshot_delta() (may be empty list)
        workspace_name: display name of the workspace (for prompt context)

    Returns:
        dict with keys: insight_summary, technical_diagnosis,
                        recommended_action, priority_score, _meta

    Raises:
        EnvironmentError : GEMINI_API_KEY not configured
        ValueError       : response could not be parsed as JSON
        KeyError         : response JSON is missing required fields
    """
    if not GEMINI_API_KEY:
        raise EnvironmentError(
            "GEMINI_API_KEY is not set. "
            "Add GEMINI_API_KEY=<your-key> to backend/.env to enable AI narratives. "
            "Get a free key at https://aistudio.google.com/app/apikey"
        )

    client = genai.Client(api_key=GEMINI_API_KEY)

    config = genai_types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        temperature=0.2,
        max_output_tokens=512,
    )

    user_message = _build_user_message(snapshot_rows, workspace_name)

    print(f"[ai_narrative] calling {GEMINI_MODEL} -- {len(snapshot_rows)} delta row(s)", flush=True)
    t0 = time.perf_counter()
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        config=config,
        contents=user_message,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)
    print(f"[ai_narrative] response received in {latency_ms}ms", flush=True)

    raw_text = response.text.strip()

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Gemini returned non-JSON. Raw response:\n{raw_text}"
        ) from exc

    missing = _REQUIRED_FIELDS - set(parsed.keys())
    if missing:
        raise KeyError(f"Gemini response missing required fields: {sorted(missing)}")

    score = parsed.get("priority_score")
    if not isinstance(score, int) or score not in range(1, 6):
        raise ValueError(f"priority_score must be an integer 1–5, got: {score!r}")

    parsed["_meta"] = {
        "model":      GEMINI_MODEL,
        "latency_ms": latency_ms,
        "row_count":  len(snapshot_rows),
        "workspace":  workspace_name,
    }

    return parsed
