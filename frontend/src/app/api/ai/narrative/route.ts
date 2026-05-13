import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";

// ─── Workspace resolution ─────────────────────────────────────────────────────

async function resolveWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", user.id)
    .single();
  if (!profile?.workspace_id) return null;

  const { data: ws } = await supabase
    .from("workspaces")
    .select("name, slug")
    .eq("id", profile.workspace_id)
    .single();

  return {
    id:   profile.workspace_id as string,
    name: (ws?.name as string) ?? DEFAULT_WORKSPACE.name,
    slug: (ws?.slug as string) ?? DEFAULT_WORKSPACE.slug,
  };
}

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
    · Semantic registry mismatches, conversion action gaps (non-tracking)
    · NOTE: [TRACKING] governance failures (UTM gaps, GA4 unavailable) are NOT P3 —
      they elevate to P1 via Layer 0 (see below)

## Financial Impact — MANDATORY for P1 and P2
For EVERY P1 or P2 finding, include a BRL estimate inside technical_diagnosis:
  · Waste: "R$ X in spend with zero conversions"
  · CPA degradation: "CPA rose from R$X to R$Y = R$Z extra cost per conversion"
  · Funnel gap: "~N leads/month lost at current traffic volume"
  · Scale opportunity: "reallocating R$X to campaign B projected +N conversions"

## Input format
The user message contains up to four sections:

  SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period, always present)
    campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS [· budget_total (R$) when available]
    budget_total = daily_budget × period_days (approximation; use for pace/waste ratio context only)

  SECTION 2 — DETERMINISTIC SIGNALS (rule-based engine, always reliable)
    Pre-detected anomalies with severity and financial context already quantified.
    If Section 2 contains waste > R$ 500 → P1 confirmed → priority_score = 5.

  SECTION 3 — DELTA ANALYSIS (D-1 vs D-8, |delta| > 15%, may be empty)
    campaign_name · metric_name · value_now · value_then · delta_percentage · impact_level
    If empty: base diagnosis on Sections 1 and 2 only.

  SECTION 4 — GOVERNANCE SIGNALS (rule-based tracking/data checks, always reliable)
    Categories: [TRACKING] | [DATA] | [SEMANTIC]
    [TRACKING] findings affect the reliability of ALL performance diagnosis — evaluate FIRST.
    format: check_name · status · severity
    If empty: assume tracking is intact and data is clean.

## Available delta metrics — STRICT BOUNDARY (Section 3 only)
spend, conversions, clicks, cpa, cpc, ctr.
DO NOT infer: impressions, reach, frequency, quality_score, or any absent metric.

## Layer 0 — Tracking Integrity (evaluate BEFORE performance patterns)

If Section 4 contains [TRACKING] findings with status failed or warning, evaluate these FIRST:

  utm_campaign_empty_in_paid_urls — failed/warning
    → UTM attribution broken. Campaign-level conversion data is UNRELIABLE.
    → Elevate to P1 (priority_score ≥ 4) regardless of conversion numbers.
    → Begin technical_diagnosis with:
      "⚠️ TRACKING: utm_campaign attribution compromised. Conversion figures cannot be
       attributed at campaign level — observed zeros may reflect attribution gaps, not true
       campaign performance."

  ga4_dataset_available — failed
    → No GA4 session data. Funnel analysis is impossible.
    → Caveat all P1 funnel findings: "GA4 unavailable — direct funnel diagnosis blocked."

  ga4_ads_overlap_insufficient — failed/warning
    → GA4 ↔ Ads session match below threshold. Cross-channel signals are partially unreliable.
    → Note in technical_diagnosis: "Cross-channel attribution has low confidence."

  ga4_non_production_traffic_detected — failed/warning
    → Non-production sessions contaminate conversion data.
    → Caveat conversion counts: "Possible data contamination from non-production traffic."

If Layer 0 is clean (no [TRACKING] issues in Section 4): proceed directly to performance
pattern matching below.

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

## Financial Forecaster

Applies only when [CONTEXT] in SECTION 1 provides period progress AND at least one campaign has budget_total.

Aggregate across campaigns that have budget_total > 0:
  - total_budget          = SUM(budget_total)
  - total_cost            = SUM(cost for those same campaigns)
  - burn_rate             = total_cost ÷ days_elapsed  (from [CONTEXT])
  - estimated_total_spend = burn_rate × total_period_days

Determine pacing_status:
  'over'      if estimated_total_spend > total_budget × 1.05  → estouro projetado
  'under'     if estimated_total_spend < total_budget × 0.85  → sub-utilização de verba
  'on_track'  otherwise

days_until_exhaustion (only when pacing_status = 'over'):
  FLOOR((total_budget − total_cost) ÷ burn_rate)
  Set to null for 'on_track' or 'under'.

recommendation (pt-BR, max 80 chars):
  'over'     → e.g. "Reduzir lance em 10% para evitar estouro de orçamento"
  'under'    → e.g. "Aumentar lance para maximizar alcance no período restante"
  'on_track' → "Manter estratégia atual — pace dentro do orçamento"

If NO campaign has budget_total > 0: omit budget_pacing entirely from the JSON output.

## Ad Group Intelligence — [CREATIVE_CONTEXT]

Applies ONLY when SECTION 5 is present in the user message.

Use SECTION 5 to enrich diagnosis and Playbooks with specific Ad Group names.

Drain rule — MANDATORY when SECTION 5 contains drain groups:
  · Drain group = cost > R$0, conversions = 0
  · If a drain group has cost > R$100 → name it explicitly in technical_diagnosis
  · If a drain group has cost > R$100 → the suggested_playbook task MUST cite its name:
      effort = 'low'  (pausing is a single click)
      task:   "Pausar grupo '<name>' — CTR X%, R$Y sem retorno"
      impact: "Economia de R$Y no período restante"
  · If CTR < 1.0% → add in evidence: "CTR crítico de X% — fadiga criativa ou segmentação inadequada"

Top performer rule:
  · If a top group has CTR > 10% AND conversions > 0 → cite in recommended_action:
      "Aumentar verba do grupo '<name>' — CTR X% com retorno comprovado (sujeito à aprovação do gestor)"

Ad Strength signal:
  POOR / AVERAGE   → creative quality issue — elevate confidence of creative diagnosis
  GOOD / EXCELLENT → creative is not the bottleneck; look at audience or landing page
  UNSPECIFIED      → video/display ad — apply video-specific patterns (CTR benchmark < 0.5%)

If SECTION 5 is absent: skip all ad-group-specific rules; base diagnosis on Sections 1–4 only.

## Playbook Engine — [ACTIONABLE_PLAYBOOKS]

Applies ONLY when budget_pacing is being generated (i.e. [CONTEXT] + budget_total are present).

MANDATORY rule:
  · pacing_status = 'over'     → MUST generate suggested_playbooks[] (2–4 items)
  · pacing_status = 'under'    → MUST generate suggested_playbooks[] (2–4 items)
  · pacing_status = 'on_track' → suggested_playbooks MUST be [] (empty array)

Each playbook item:
  task   — specific action in pt-BR, max 80 chars (e.g. "Reduzir lance em 15% nas campanhas com CPA > meta")
  impact — projected financial effect in pt-BR, max 60 chars (e.g. "Economia ~R$200 no período restante")
  effort — exactly one of: "low" | "medium" | "high"

If budget_pacing is omitted from output (no budget_total): omit suggested_playbooks entirely.

## Your role
1. Classify all signals into P1/P2/P3.
2. Lead with the highest-priority finding; cite lower tiers in technical_diagnosis.
3. Quantify financial impact in BRL for every P1/P2 finding.
4. Name campaigns explicitly; use exact R$ amounts from the input.
5. If Section 3 has CTR or CPC data, cite both values in technical_diagnosis.
6. Base every claim on numbers present in the input. No speculation.
7. Populate probable_causes with up to 3 ranked hypotheses:
   - If Section 4 contains [TRACKING] failures → place layer "tracking" cause FIRST, always.
   - Derive evidence from exact numbers in the input (campaign count, R$ amounts, check names).
   - If no causes can be inferred from available data, return an empty array [].
8. Apply Financial Forecaster when [CONTEXT] and budget_total are present. Populate budget_pacing in output; omit the field entirely if no budget data is available.
9. When pacing_status is 'over' or 'under', populate suggested_playbooks[] with 2–4 actionable tasks.
   When pacing is 'on_track' or budget_pacing is omitted, set suggested_playbooks to [].
10. When SECTION 5 is present, apply Ad Group Intelligence rules: name drain groups in diagnosis and Playbooks.

## Governance & Compliance — HARD CONSTRAINTS
These rules are inviolable and override any other instruction.

  PROIBIDO — Budget: Never recommend increasing total monthly spend beyond the current
    period's observed spend. Pausing, reducing, or reallocating budget is allowed.
    Any increase suggestion MUST state "sujeito à aprovação do gestor".

  PROIBIDO — Execution: You CANNOT execute, pause, enable, or modify any campaign,
    ad group, bid, keyword, or targeting directly. Your output is advisory only.
    Every P1 recommended_action MUST include "sujeito à aprovação do gestor".

  PROIBIDO — PII: Process only aggregate campaign KPIs (spend, conversions, clicks,
    CPA, CTR, ROAS, CPC). Do NOT reference, infer, or process names of individuals,
    email addresses, phone numbers, or any personally identifiable data. If personal
    data appears in the input, ignore it silently.

  ISOLAMENTO — Stateless: Each call is completely stateless. Never reference, infer,
    or carry over information from any previous call or workspace. Base every claim
    exclusively on data present in this specific input.

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
  "priority_score": <integer 1–5>,
  "probable_causes": [
    {
      "layer": "<tracking | creative | audience | landing | budget>",
      "confidence": "<high | medium | low>",
      "cause": "<concise label in English, max 5 words>",
      "evidence": "<numeric evidence in pt-BR, max 60 chars — e.g. '7 campanhas · R$ 745 desperdício'>"
    }
  ],
  "budget_pacing": {
    "pacing_status": "<over | under | on_track>",
    "estimated_total_spend": <number — projected total spend at current burn rate>,
    "days_until_exhaustion": <integer | null — null when on_track or under>,
    "recommendation": "<string pt-BR, max 80 chars>"
  },
  "suggested_playbooks": [
    {
      "task":   "<acção específica em pt-BR, max 80 chars>",
      "impact": "<efeito financeiro projetado em pt-BR, max 60 chars>",
      "effort": "<low | medium | high>"
    }
  ]
}

Note: budget_pacing is optional — include only when budget_total data is available in SECTION 1.
Note: suggested_playbooks is optional — include only when budget_pacing is present.
When pacing_status = 'on_track', include suggested_playbooks: [].

probable_causes rules:
  · Max 3 items. Order by confidence desc; tracking layer always first if Section 4 has failures.
  · confidence = high when direct evidence is in the input; medium when inferred; low when speculative.
  · layer must be exactly one of: tracking | creative | audience | landing | budget.
  · If no causes can be identified → return "probable_causes": [].

Priority score:
  5 — P1 Critical: waste > R$ 500 OR CRITICAL CPA delta — act immediately
  4 — P1 Urgent: CPA SIGNIFICANT or spend with zero conversions — act today
  3 — P2 Important: scale opportunity or funnel gap — act within 48h
  2 — P3 Monitor: governance or mixed signals — watch this week
  1 — Informational: no actionable finding`;

// ─── Types ────────────────────────────────────────────────────────────────────

type ProbableCause = {
  layer:      "tracking" | "creative" | "audience" | "landing" | "budget";
  confidence: "high" | "medium" | "low";
  cause:      string;
  evidence:   string;
};

type SnapshotRow = {
  campaign_name:    string;
  metric_name:      string;
  value_now:        number;
  value_then:       number;
  delta_percentage: number;
  impact_level:     string;
};

type CampaignRow = {
  campaign_name:   string;
  cost:            string | number;
  conversions:     string | number;
  roas:            string | number;
  clicks:          number;
  ctr:             string | number;
  daily_budget:    string | number | null;
  budget_total:    string | number | null;
  date_range_start: string | null;
  date_range_end:   string | null;
};

type DeterministicSignal = {
  severity:    string;
  description: string;
};

type GovernanceFinding = {
  check_name: string;
  status:     string;
  severity:   string;
};

type PeriodCtx = {
  todayStr:    string;
  periodStart: string;
  periodEnd:   string;
  daysElapsed: number;
  totalDays:   number;
  progressPct: number;
};

type BudgetPacing = {
  pacing_status:         "over" | "under" | "on_track";
  estimated_total_spend: number;
  days_until_exhaustion: number | null;
  recommendation:        string;
};

type SuggestedPlaybook = {
  task:   string;
  impact: string;
  effort: "low" | "medium" | "high";
};

type AdGroupRow = {
  ad_group_id:   string;
  ad_group_name: string;
  campaign_name: string;
  cost:          string | number;
  clicks:        number;
  impressions:   number;
  ctr:           string | number;
  conversions:   string | number;
  roas:          string | number;
  ad_strength:   string | null;
};

// Checks that affect reliability of ALL performance diagnosis
const TRACKING_CHECKS = new Set([
  "ga4_dataset_available",
  "ga4_ads_overlap_insufficient",
  "utm_campaign_empty_in_paid_urls",
  "ga4_non_production_traffic_detected",
  "ga4_suspicious_event_names_detected",
]);

const DATA_CHECKS = new Set([
  "campaign_summary_missing_campaign_id",
  "campaign_summary_freshness",
  "keyword_analysis_freshness",
  "mock_data_presence",
  "ga4_events_freshness",
  "ga4_has_page_view",
  "ga4_has_session_start",
  "ga4_has_conversion_events",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computePeriodCtx(campaignRows: CampaignRow[]): PeriodCtx | null {
  const firstRow = campaignRows.find(
    (r) => r.date_range_start && r.date_range_end,
  );
  if (!firstRow?.date_range_start || !firstRow?.date_range_end) return null;

  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(firstRow.date_range_start);
  const end   = new Date(firstRow.date_range_end);

  const totalDays   = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const rawElapsed  = Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
  const daysElapsed = Math.max(1, Math.min(rawElapsed, totalDays));
  const progressPct = Math.round((daysElapsed / totalDays) * 100);

  const pad      = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return {
    todayStr,
    periodStart: firstRow.date_range_start,
    periodEnd:   firstRow.date_range_end,
    daysElapsed,
    totalDays,
    progressPct,
  };
}

function buildUserMessage(
  snapshotRows: SnapshotRow[],
  workspaceName: string,
  campaignRows: CampaignRow[],
  deterministicSignals: DeterministicSignal[],
  governanceFindings: GovernanceFinding[],
  periodCtx: PeriodCtx | null,
  adGroupRows: AdGroupRow[],
): string {
  const parts: string[] = [`Workspace: ${workspaceName}`];

  // Section 1 — Campaign Performance
  if (campaignRows.length > 0) {
    const lines: string[] = ["SECTION 1 — CAMPAIGN PERFORMANCE (current 30-day period)"];
    if (periodCtx) {
      lines.push(
        `[CONTEXT] Today is ${periodCtx.todayStr}. Period: ${periodCtx.periodStart}..${periodCtx.periodEnd}` +
        ` (${periodCtx.totalDays} days). Progress: ${periodCtx.daysElapsed}/${periodCtx.totalDays} days (${periodCtx.progressPct}%).`,
      );
    }
    lines.push(
      "campaign_name · spend (R$) · conversions · CPA (R$/conv) · ROAS [· budget_total (R$) when available]",
      "budget_total = daily_budget × period_days (approximation; use for pace/waste ratio context only)",
    );
    for (const r of campaignRows) {
      const cost        = parseFloat(String(r.cost))  || 0;
      const convs       = parseFloat(String(r.conversions)) || 0;
      const cpa         = convs > 0 ? `R$${(cost / convs).toFixed(2)}` : "N/A";
      const roas        = parseFloat(String(r.roas))  || 0;
      const budgetTotal = r.budget_total != null ? parseFloat(String(r.budget_total)) : null;
      const dailyBudget = r.daily_budget != null ? parseFloat(String(r.daily_budget)) : null;
      const budgetStr   = budgetTotal != null
        ? ` · budget_total R$${budgetTotal.toFixed(2)}`
        : dailyBudget != null
          ? ` · daily_budget R$${dailyBudget.toFixed(2)}/day`
          : "";
      lines.push(`  ${r.campaign_name} · R$${cost.toFixed(2)} · ${Math.round(convs)} · ${cpa} · ${roas.toFixed(2)}${budgetStr}`);
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

  // Section 4 — Governance Signals
  if (governanceFindings.length > 0) {
    const tracking = governanceFindings.filter((f) => TRACKING_CHECKS.has(f.check_name));
    const data     = governanceFindings.filter((f) => !TRACKING_CHECKS.has(f.check_name) && DATA_CHECKS.has(f.check_name));
    const semantic = governanceFindings.filter((f) => !TRACKING_CHECKS.has(f.check_name) && !DATA_CHECKS.has(f.check_name));

    const lines = [
      "SECTION 4 — GOVERNANCE SIGNALS (rule-based, always reliable)",
      "Evaluate [TRACKING] findings FIRST — they affect reliability of all performance diagnosis.",
    ];
    for (const f of tracking) lines.push(`  [TRACKING] ${f.check_name}: ${f.status} · ${f.severity}`);
    for (const f of data)     lines.push(`  [DATA] ${f.check_name}: ${f.status} · ${f.severity}`);
    for (const f of semantic) lines.push(`  [SEMANTIC] ${f.check_name}: ${f.status} · ${f.severity}`);
    parts.push(lines.join("\n"));
  } else {
    parts.push("SECTION 4 — GOVERNANCE SIGNALS\n(clean — no tracking or data integrity issues detected)");
  }

  // Section 5 — Ad Group Intelligence
  if (adGroupRows.length > 0) {
    const drains = adGroupRows
      .filter((r) => parseFloat(String(r.conversions)) === 0 && parseFloat(String(r.cost)) > 0)
      .sort((a, b) => parseFloat(String(b.cost)) - parseFloat(String(a.cost)))
      .slice(0, 3);

    const tops = adGroupRows
      .filter((r) => parseFloat(String(r.conversions)) > 0)
      .sort((a, b) => parseFloat(String(b.roas)) - parseFloat(String(a.roas)))
      .slice(0, 2);

    const lines = [
      "SECTION 5 — AD GROUP INTELLIGENCE [CREATIVE_CONTEXT]",
      "Use ad group names to enrich diagnosis and Playbooks per Ad Group Intelligence rules.",
    ];

    if (drains.length > 0) {
      lines.push("Drain groups (cost > R$0, zero conversions — evaluate for pause):");
      for (const r of drains) {
        const cost = parseFloat(String(r.cost));
        const ctr  = parseFloat(String(r.ctr)) * 100;
        lines.push(
          `  Ad Group '${r.ad_group_name}' [campaign: ${r.campaign_name}]: ` +
          `Cost R$${cost.toFixed(2)}, CTR ${ctr.toFixed(2)}%, Conv 0, Strength: ${r.ad_strength ?? "UNSPECIFIED"}`,
        );
      }
    }

    if (tops.length > 0) {
      lines.push("Top performers (highest ROAS, conversions > 0 — scale candidates):");
      for (const r of tops) {
        const cost = parseFloat(String(r.cost));
        const ctr  = parseFloat(String(r.ctr)) * 100;
        const conv = parseFloat(String(r.conversions));
        const roas = parseFloat(String(r.roas));
        lines.push(
          `  Ad Group '${r.ad_group_name}' [campaign: ${r.campaign_name}]: ` +
          `Cost R$${cost.toFixed(2)}, CTR ${ctr.toFixed(2)}%, Conv ${Math.round(conv)}, ROAS ${roas.toFixed(2)}, Strength: ${r.ad_strength ?? "UNSPECIFIED"}`,
        );
      }
    }

    parts.push(lines.join("\n"));
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

    const workspace = await resolveWorkspace(supabase);
    if (!workspace) {
      return NextResponse.json(
        { ok: false, offline: true, error: "Unauthorized" },
        { status: 401 },
      );
    }

    // Fetch snapshot delta, campaign summary, governance findings, and ad groups in parallel
    const [snapshotResult, campaignResult, governanceResult, adGroupResult] = await Promise.all([
      supabase.rpc("fn_campaign_snapshot_delta", { target_workspace_id: workspace.id }),
      supabase
        .from("campaign_summary")
        .select("campaign_name, cost, conversions, roas, clicks, ctr, daily_budget, budget_total, date_range_start, date_range_end")
        .eq("workspace_id", workspace.id)
        .order("date_range_end", { ascending: false })
        .order("loaded_at",      { ascending: false })
        .limit(100),
      supabase
        .from("data_quality_report")
        .select("check_name, status, severity")
        .eq("workspace_id", workspace.id)
        .in("status", ["failed", "warning"])
        .order("checked_at", { ascending: false })
        .limit(60),
      supabase
        .from("ad_group_summary")
        .select("ad_group_id, ad_group_name, campaign_name, cost, clicks, impressions, ctr, conversions, roas, ad_strength")
        .eq("workspace_id", workspace.id)
        .order("loaded_at", { ascending: false })
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

    // Deduplicate governance findings: most recent per check_name
    const seenChecks = new Set<string>();
    const governanceFindings: GovernanceFinding[] = (governanceResult.data ?? []).filter((r) => {
      if (seenChecks.has(r.check_name)) return false;
      seenChecks.add(r.check_name);
      return true;
    });

    // Deduplicate ad group rows — keep most recent per ad_group_id
    const seenGroups = new Set<string>();
    const adGroupRows: AdGroupRow[] = [];
    for (const row of adGroupResult.data ?? []) {
      if (!seenGroups.has(row.ad_group_id)) {
        seenGroups.add(row.ad_group_id);
        adGroupRows.push(row as AdGroupRow);
      }
    }

    // Compute period context for Burn Rate Predictor
    const periodCtx = computePeriodCtx(campaignRows);

    // Build enriched user message
    const userMessage = buildUserMessage(
      snapshotRows,
      workspace.name,
      campaignRows,
      deterministicSignals,
      governanceFindings,
      periodCtx,
      adGroupRows,
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

    // Normalise probable_causes — default to [] if absent or malformed
    const rawCauses = parsed.probable_causes;
    parsed.probable_causes = Array.isArray(rawCauses) ? rawCauses as ProbableCause[] : [];

    // Normalise budget_pacing — include only when valid; strip otherwise
    const rawPacing = parsed.budget_pacing;
    if (
      rawPacing &&
      typeof rawPacing === "object" &&
      "pacing_status" in rawPacing &&
      ["over", "under", "on_track"].includes((rawPacing as BudgetPacing).pacing_status)
    ) {
      parsed.budget_pacing = rawPacing as BudgetPacing;
    } else {
      delete parsed.budget_pacing;
    }

    // Normalise suggested_playbooks — include only when valid array; strip otherwise
    const rawPlaybooks = parsed.suggested_playbooks;
    if (Array.isArray(rawPlaybooks)) {
      parsed.suggested_playbooks = (rawPlaybooks as SuggestedPlaybook[]).filter(
        (p) => p && typeof p.task === "string" && ["low", "medium", "high"].includes(p.effort),
      );
    } else {
      delete parsed.suggested_playbooks;
    }

    parsed.insight_summary = truncateSummary(String(parsed.insight_summary));
    parsed.is_simulated = false;
    parsed._meta = {
      model:              GEMINI_MODEL,
      row_count:          snapshotRows.length,
      campaign_count:     campaignRows.length,
      waste_campaigns:    zeroConvCampaigns.length,
      total_waste_brl:    totalWaste,
      workspace:          workspace.name,
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
