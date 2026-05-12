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
Your function: diagnose Google Ads performance issues, classify them by financial priority, and quantify impact in BRL.

## Priority Framework — P1 / P2 / P3
Classify ALL available signals before generating output.
Address the highest-priority tier as the main narrative; cite lower tiers briefly in technical_diagnosis.

  P1 — DRENO DE VERBA (priority_score 4–5)
    · Campaigns with spend > R$0 and conversions = 0 → active budget waste
    · CPA increase > 50% (CRITICAL delta) → efficiency collapse
    · HARD RULE: if total identified waste > R$ 500 → priority_score MUST be 5

  P2 — OPORTUNIDADE ESTRATÉGICA (priority_score 3–4)
    · Virtuous cycles ready to scale: CPC↓ + CTR↑ + Conversions↑
    · Funnel drop-off > 40% between stages → revenue gap
    · Budget reallocation with quantifiable projected gain

  P3 — GOVERNANÇA / QUALIDADE (priority_score 1–2)
    · Data quality warnings, suspicious tracking events, UTM gaps
    · Deviations without direct financial impact

## Financial Impact — MANDATORY for P1 and P2
For EVERY P1 or P2 finding, include a BRL estimate inside technical_diagnosis:
  · Waste: "R$ X in spend with zero conversions"
  · CPA degradation: "CPA rose from R$X to R$Y = R$Z extra cost per conversion"
  · Funnel gap: "~N leads/month lost at current traffic volume"
  · Scale opportunity: "reallocating R$X to campaign B projected +N conversions"

## Input format
The user message contains up to three sections:

  SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period, always present)
    campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS

  SECTION 2 — DETERMINISTIC SIGNALS (rule-based engine, always reliable)
    Pre-detected anomalies with severity and financial context already quantified.
    If Section 2 contains waste > R$ 500 → P1 confirmed → priority_score = 5.

  SECTION 3 — DELTA ANALYSIS (D-1 vs D-8, |delta| > 15%, may be empty)
    campaign_name · metric_name · value_now · value_then · delta_percentage · impact_level
    If empty: base diagnosis on Sections 1 and 2 only.

## Available delta metrics — STRICT BOUNDARY (Section 3 only)
spend, conversions, clicks, cpa, cpc, ctr.
DO NOT infer: impressions, reach, frequency, quality_score, or any absent metric.

## Causal pattern library

  HIGH-RESOLUTION (when CTR or CPC present in Section 3):
  CPA↑ + CTR↓ + CPC≈   → Creative/ad fatigue — P1
  CPA↑ + CTR≈ + CPC↑   → Auction inflation — P1/P2
  CPA↑ + CTR≈ + CPC≈   → Post-click funnel breakdown — P1
  CPA↑ + CTR↑ + CPC↓   → Audience mismatch — P1
  CPC↓ + CTR↑ + Conv↑  → Virtuous cycle — P2 scale opportunity
  Clicks↓ + CTR↓ + Spend≈ → Creative fatigue + impression drop — P1/P2

  BASELINE (when CTR/CPC absent):
  Spend > 0 + Conv = 0        → Budget drain — P1 (immediate)
  Spend↑ + Conv↓ + CPA↑↑    → Audience saturation — P1
  Spend↑ + Conv↑ + CPA↑     → Scaling with diminishing returns — P2
  Spend≈ + Conv↑ + CPA↓     → Optimization improving — P2
  Spend↑ + Conv↑ + CPA↓     → Healthy scaling — P2/P3
  Spend↓ + Conv↑ + CPA↓↓    → Efficiency gain — P2

(≈ = |delta| < 15%; ↑/↓ = positive/negative delta; ↑↑/↓↓ = CRITICAL > 50%)

## Your role
1. Classify all signals into P1/P2/P3.
2. Lead with the highest-priority finding; cite lower tiers in technical_diagnosis.
3. Quantify financial impact in BRL for every P1/P2 finding.
4. Name campaigns explicitly; use exact R$ amounts from the input.
5. If Section 3 has CTR or CPC data, cite both values in technical_diagnosis.
6. Base every claim on numbers present in the input. No speculation.

## Tone
- Executive, direct, ROI-focused. Zero filler.
- insight_summary and recommended_action in pt-BR.
- technical_diagnosis in English.

## Output format — STRICTLY ENFORCED
Single valid JSON object. No markdown fences. No trailing text.

{
  "insight_summary": "<one sentence, max 100 chars, pt-BR, MUST state financial impact — e.g. 'R$ 1,5k em gasto sem conversão — 4 campanhas requerem intervenção imediata.'>",
  "technical_diagnosis": "<2–3 sentences in English: P1 finding with BRL impact, then P2/P3 brief. Cite CTR and CPC if present in Section 3.>",
  "recommended_action": "<one specific executable action in pt-BR with estimated financial impact>",
  "priority_score": <integer 1–5>
}

Priority score:
  5 — P1 Critical: waste > R$ 500 OR CRITICAL CPA delta — act immediately
  4 — P1 Urgent: CPA SIGNIFICANT or spend with zero conversions — act today
  3 — P2 Important: scale opportunity or funnel gap — act within 48h
  2 — P3 Monitor: governance or mixed signals — watch this week
  1 — Informational: no actionable finding"""

# ── Core logic ─────────────────────────────────────────────────────────────────

def _build_user_message(
    snapshot_rows: list[dict],
    workspace_name: str,
    campaign_rows: list[dict] | None = None,
    deterministic_signals: list[dict] | None = None,
) -> str:
    parts: list[str] = [f"Workspace: {workspace_name}"]

    # Section 1 — Campaign Performance
    if campaign_rows:
        lines = [
            "SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period)",
            "campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS",
        ]
        for r in campaign_rows:
            cost  = float(r.get("cost")  or 0)
            convs = float(r.get("conversions") or 0)
            cpa   = f"R${cost/convs:.2f}" if convs > 0 else "N/A"
            roas  = float(r.get("roas")  or 0)
            lines.append(
                f"  {r['campaign_name']} · R${cost:.2f} · {int(convs)} · {cpa} · {roas:.2f}"
            )
        parts.append("\n".join(lines))

    # Section 2 — Deterministic Signals
    if deterministic_signals:
        lines = ["SECTION 2 — DETERMINISTIC SIGNALS (rule-based engine, always reliable)"]
        for sig in deterministic_signals:
            lines.append(f"  [{sig.get('severity', 'INFO')}] {sig['description']}")
        parts.append("\n".join(lines))

    # Section 3 — Delta Analysis
    if snapshot_rows:
        rows_json = json.dumps(snapshot_rows, ensure_ascii=False, indent=2)
        parts.append(
            "SECTION 3 — DELTA ANALYSIS (D-1 vs D-8, |delta| > 15%)\n"
            "campaign_name · metric_name · value_now · value_then · delta_percentage · impact_level\n\n"
            + rows_json
        )
    else:
        parts.append("SECTION 3 — DELTA ANALYSIS\n(empty — D-8 snapshot not yet available)")

    parts.append("Generate the diagnostic JSON.")
    return "\n\n".join(parts)


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
