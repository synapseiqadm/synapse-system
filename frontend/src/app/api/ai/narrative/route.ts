import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";

// ─── Config ───────────────────────────────────────────────────────────────────

const GEMINI_MODEL   = "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── System prompt (mirrors backend/connectors/ai_narrative.py) ───────────────

const SYSTEM_PROMPT = `You are a Senior Growth Analyst embedded in a performance marketing agency.
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
  1 — Informational: no actionable finding`;

// ─── Types ────────────────────────────────────────────────────────────────────

type SnapshotRow = {
  campaign_name:    string;
  metric_name:      string;
  value_now:        number;
  value_then:       number;
  delta_percentage: number;
  impact_level:     string;
};

type CampaignRow = {
  campaign_name: string;
  cost:          string | number;
  conversions:   string | number;
  roas:          string | number;
  clicks:        number;
  ctr:           string | number;
};

type DeterministicSignal = {
  severity:    string;
  description: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserMessage(
  snapshotRows: SnapshotRow[],
  workspaceName: string,
  campaignRows: CampaignRow[],
  deterministicSignals: DeterministicSignal[],
): string {
  const parts: string[] = [`Workspace: ${workspaceName}`];

  // Section 1 — Campaign Performance
  if (campaignRows.length > 0) {
    const lines = [
      "SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period)",
      "campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS",
    ];
    for (const r of campaignRows) {
      const cost  = parseFloat(String(r.cost))  || 0;
      const convs = parseFloat(String(r.conversions)) || 0;
      const cpa   = convs > 0 ? `R$${(cost / convs).toFixed(2)}` : "N/A";
      const roas  = parseFloat(String(r.roas))  || 0;
      lines.push(`  ${r.campaign_name} · R$${cost.toFixed(2)} · ${Math.round(convs)} · ${cpa} · ${roas.toFixed(2)}`);
    }
    parts.push(lines.join("\n"));
  }

  // Section 2 — Deterministic Signals
  if (deterministicSignals.length > 0) {
    const lines = ["SECTION 2 — DETERMINISTIC SIGNALS (rule-based engine, always reliable)"];
    for (const sig of deterministicSignals) {
      lines.push(`  [${sig.severity}] ${sig.description}`);
    }
    parts.push(lines.join("\n"));
  }

  // Section 3 — Delta Analysis
  if (snapshotRows.length > 0) {
    parts.push(
      "SECTION 3 — DELTA ANALYSIS (D-1 vs D-8, |delta| > 15%)\n" +
      "campaign_name · metric_name · value_now · value_then · delta_percentage · impact_level\n\n" +
      JSON.stringify(snapshotRows, null, 2),
    );
  } else {
    parts.push("SECTION 3 — DELTA ANALYSIS\n(empty — D-8 snapshot not yet available)");
  }

  parts.push("Generate the diagnostic JSON.");
  return parts.join("\n\n");
}

function truncateSummary(summary: string, max = 100): string {
  if (summary.length <= max) return summary;
  const cut = summary.lastIndexOf(" ", max - 3);
  return ((cut > 0 ? summary.slice(0, cut) : summary.slice(0, max - 3)) + "...");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  if (!GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, offline: true, error: "GEMINI_API_KEY not configured" },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClient();

    // Fetch snapshot delta and campaign summary in parallel
    const [snapshotResult, campaignResult] = await Promise.all([
      supabase.rpc("fn_campaign_snapshot_delta", { target_workspace_id: DEFAULT_WORKSPACE.id }),
      supabase
        .from("campaign_summary")
        .select("campaign_name, cost, conversions, roas, clicks, ctr")
        .eq("workspace_id", DEFAULT_WORKSPACE.id)
        .order("date_range_end", { ascending: false })
        .order("loaded_at",      { ascending: false })
        .limit(100),
    ]);

    if (snapshotResult.error) {
      console.error("[narrative] Supabase RPC error:", snapshotResult.error.message);
      return NextResponse.json(
        { ok: false, offline: true, error: "Snapshot unavailable" },
        { status: 502 },
      );
    }

    const snapshotRows: SnapshotRow[] = snapshotResult.data ?? [];

    // Deduplicate campaign rows — keep most recent snapshot per campaign
    const seen = new Set<string>();
    const campaignRows: CampaignRow[] = [];
    for (const row of campaignResult.data ?? []) {
      if (!seen.has(row.campaign_name)) {
        seen.add(row.campaign_name);
        campaignRows.push(row as CampaignRow);
      }
    }

    // Derive deterministic signals: campaigns with spend > 0 and zero conversions
    const zeroConvCampaigns = campaignRows.filter(
      (r) => parseFloat(String(r.cost)) > 0 && parseFloat(String(r.conversions)) === 0,
    );
    const totalWaste = zeroConvCampaigns.reduce(
      (sum, r) => sum + parseFloat(String(r.cost)), 0,
    );

    const deterministicSignals: DeterministicSignal[] = [];
    if (zeroConvCampaigns.length > 0) {
      const names = zeroConvCampaigns
        .map((c) => `${c.campaign_name} (R$${parseFloat(String(c.cost)).toFixed(2)})`)
        .join("; ");
      deterministicSignals.push({
        severity:    totalWaste > 500 ? "CRITICAL" : "SIGNIFICANT",
        description: `${zeroConvCampaigns.length} campaign(s) with R$${totalWaste.toFixed(2)} total spend and ZERO conversions: ${names}`,
      });
    }

    // Build enriched user message
    const userMessage = buildUserMessage(
      snapshotRows,
      DEFAULT_WORKSPACE.name,
      campaignRows,
      deterministicSignals,
    );

    // Call Gemini REST API
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[narrative] Gemini error:", geminiRes.status, errText);
      return NextResponse.json(
        { ok: false, offline: true, error: "AI service unavailable" },
        { status: 502 },
      );
    }

    const geminiBody = await geminiRes.json();
    const rawText: string = geminiBody?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error("[narrative] Gemini returned non-JSON:", rawText.slice(0, 200));
      return NextResponse.json(
        { ok: false, offline: true, error: "Malformed AI response" },
        { status: 502 },
      );
    }

    // Validate required fields
    const required = ["insight_summary", "technical_diagnosis", "recommended_action", "priority_score"];
    const missing = required.filter((f) => !(f in parsed));
    if (missing.length > 0) {
      console.error("[narrative] Missing fields:", missing);
      return NextResponse.json(
        { ok: false, offline: true, error: "Incomplete AI response" },
        { status: 502 },
      );
    }

    parsed.insight_summary = truncateSummary(String(parsed.insight_summary));
    parsed.is_simulated = false;
    parsed._meta = {
      model:              GEMINI_MODEL,
      row_count:          snapshotRows.length,
      campaign_count:     campaignRows.length,
      waste_campaigns:    zeroConvCampaigns.length,
      total_waste_brl:    totalWaste,
      workspace:          DEFAULT_WORKSPACE.name,
    };

    return NextResponse.json({ ok: true, data: parsed });

  } catch (err) {
    console.error("[narrative] Unexpected error:", err);
    return NextResponse.json(
      { ok: false, offline: true, error: "Unexpected error" },
      { status: 500 },
    );
  }
}
