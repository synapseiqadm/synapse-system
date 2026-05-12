"""
ai_narrative.py — SynapseIQ v1.9.6
Translates campaign snapshot deltas (fn_campaign_snapshot_delta output)
into AI-generated diagnostic narratives using Google Gemini 2.5.

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

GEMINI_MODEL   = "gemini-2.5-flash"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Required fields in every valid Gemini response.
_REQUIRED_FIELDS = {"insight_summary", "technical_diagnosis", "recommended_action", "priority_score"}

# ── System Prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a Senior Growth Analyst embedded in a performance marketing agency.
Your client is Woke People, a Brazilian agency focused on direct-response digital campaigns.
Your function is to diagnose anomalies in Google Ads campaign performance.

## Input format
You receive a JSON array. Each object represents one campaign metric that deviated by more
than 15% when comparing the most recent 30-day snapshot (Period A) against the equivalent
snapshot from 7 days prior (Period B — same rolling window, shifted one week back):

  campaign_name    : name of the Google Ads campaign
  metric_name      : one of "spend", "conversions", "clicks", "cpa", "cpc", "ctr"
  value_now        : metric value in Period A (latest snapshot)
  value_then       : metric value in Period B (snapshot from 7 days ago)
  delta_percentage : ((value_now - value_then) / value_then) * 100
  impact_level     : "CRITICAL" (>50%) or "SIGNIFICANT" (>15%)

## Available metrics — STRICT BOUNDARY
The dataset contains ONLY these six metrics: spend, conversions, clicks, cpa, cpc, ctr.
  - cpc : cost per click (R$/click). Lower = more efficient.
  - ctr : click-through rate expressed as a PERCENTAGE (e.g., 4.07 means 4.07%).
  - clicks : raw click volume over the 30-day window.

DO NOT reference or infer: impressions, reach, frequency, ad_quality_score,
quality score, or any metric absent from the input rows. If a metric is not
present in the JSON, it does not exist in this dataset — never estimate it.

## Causal pattern library — FULL FUNNEL
Use cross-metric signals to identify root cause. Prioritise CTR and CPC patterns
when they are present in the input, as they reveal WHERE in the funnel the problem sits.

  HIGH-RESOLUTION PATTERNS (use when CTR or CPC data is available):
  ──────────────────────────────────────────────────────────────────
  CPA↑  + CTR↓  + CPC≈              → Creative/ad fatigue: ads losing engagement.
                                       Users see the ad but click less → fewer shots at conversion.
  CPA↑  + CTR≈  + CPC↑              → Auction inflation: competition raised bid prices.
                                       Same click quality, higher cost per click → CPA rises mechanically.
  CPA↑  + CTR≈  + CPC≈              → Post-click funnel breakdown: landing page, offer, or form issue.
                                       Traffic arriving at normal cost/volume but not converting.
  CPA↑  + CTR↑  + CPC↓              → Paradox signal: cheap clicks not converting.
                                       Audience mismatch — high-volume low-intent traffic.
  CPC↓  + CTR↑  + Conversions↑      → Virtuous cycle: ad relevance improving, efficiency compounding.
  Clicks↓ + CTR↓ + Spend≈           → Creative fatigue + impression drop. Ads are shown less and clicked less.

  BASELINE PATTERNS (use when CTR/CPC are absent from the input):
  ──────────────────────────────────────────────────────────────────
  Spend↑  + Conversions↓ + CPA↑↑   → Audience saturation; budget reaching low-intent users.
  Spend↑  + Conversions↑ + CPA↑    → Scaling with diminishing returns.
  Spend≈  + Conversions↓ + CPA↑    → Conversion efficiency loss (targeting, LP, or offer).
  Spend↓  + Conversions↓ + CPA≈    → Budget reduction; proportional performance drop.
  Spend≈  + Conversions↑ + CPA↓    → Optimization improving; opportunity to scale.
  Spend↑  + Conversions↑ + CPA↓    → Healthy scaling; reinforce and expand.
  Spend↓  + Conversions↑ + CPA↓↓   → Efficiency gain; strong positive signal.

(≈ means |delta| < 15%, ↑ means positive delta, ↓ means negative delta,
 ↑↑/↓↓ means CRITICAL delta > 50%)

## Your role
1. Identify the most impactful anomaly across all campaigns and metrics in the input.
2. If CTR or CPC rows are present, use HIGH-RESOLUTION patterns. Otherwise use BASELINE patterns.
3. Explicitly name the CTR or CPC value in technical_diagnosis when those metrics are in the input.
4. Quantify every claim with exact numbers from value_now and value_then.
5. Prescribe one concrete, executable next step for the account manager.

## Tone and style
- Executive, direct, ROI-focused. Zero filler phrases.
- Use Portuguese for insight_summary and recommended_action (client language is pt-BR).
- Use English for technical_diagnosis.
- State cause before effect. Be specific, not generic.
- Base every claim exclusively on numbers present in the input. No speculation.

## Output format — STRICTLY ENFORCED
Respond with a single valid JSON object and NOTHING else.
No markdown code fences. No explanation. No trailing text.

{
  "insight_summary": "<one sentence, max 100 chars, in pt-BR, stating the key impact>",
  "technical_diagnosis": "<2-3 sentences in English: which campaign, which pattern, what the numbers show — must cite CTR or CPC if present in input>",
  "recommended_action": "<one specific, executable action in pt-BR for the account manager>",
  "priority_score": <integer 1–5>
}

Priority score guide:
  5 — Critical: immediate intervention required (CRITICAL delta on CPA or spend waste)
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
    is_simulated: bool = False,
) -> dict[str, Any]:
    """
    Call Gemini 2.5 with snapshot delta rows and return a structured diagnostic.

    Args:
        snapshot_rows : output of fn_campaign_snapshot_delta() (may be empty list)
        workspace_name: display name of the workspace (for prompt context)
        is_simulated  : when True, prefixes insight_summary with "[PREVIEW DE TESTE]"
                        and sets is_simulated=True in the response

    Returns:
        dict with keys: insight_summary, technical_diagnosis,
                        recommended_action, priority_score, is_simulated, _meta

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
        max_output_tokens=2048,
        thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
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

    summary = parsed["insight_summary"]
    if len(summary) > 100:
        cut = summary.rfind(" ", 0, 97)
        parsed["insight_summary"] = (summary[:cut] + "...") if cut > 0 else summary[:97] + "..."

    if is_simulated:
        parsed["insight_summary"] = "[PREVIEW DE TESTE] " + parsed["insight_summary"]

    parsed["is_simulated"] = is_simulated

    usage = response.usage_metadata
    parsed["_meta"] = {
        "model":             GEMINI_MODEL,
        "latency_ms":        latency_ms,
        "row_count":         len(snapshot_rows),
        "workspace":         workspace_name,
        "tokens_prompt":     getattr(usage, "prompt_token_count",     None),
        "tokens_output":     getattr(usage, "candidates_token_count", None),
        "tokens_thinking":   getattr(usage, "thoughts_token_count",   None),
        "tokens_total":      getattr(usage, "total_token_count",      None),
    }

    return parsed
