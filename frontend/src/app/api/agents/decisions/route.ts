import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveWorkspace } from "@/lib/resolve-workspace";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function nowTime(): string {
  return new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const AGENT_NAMES: Record<string, string> = {
  "growth-master":   "Growth Master",
  "creative-critic": "Creative Critic",
  "anomaly-scout":   "Anomaly Scout",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type DecisionStatus = "pending" | "approved" | "rejected" | "auto-applied";
type DecisionType   = "analysis" | "suggestion" | "action" | "alert";

interface ProbableCause {
  confidence: "high" | "medium" | "low";
  layer:      "tracking" | "creative" | "audience" | "landing" | "budget";
  cause:      string;
  evidence:   string;
}

interface Decision {
  id:             number;
  dbId?:          string;
  agentId:        string;
  agentName:      string;
  type:           DecisionType;
  title:          string;
  body:           string;
  timestamp:      string;
  status:         DecisionStatus;
  value?:         string;
  query?:         string;
  rationale?:     string;
  probableCauses?: ProbableCause[];
}

type CampaignRow = {
  campaign_name: string;
  cost:          string | number;
  conversions:   string | number;
  roas:          string | number;
  clicks:        number;
  ctr:           string | number;
};

type GovFindingRow = {
  check_name:      string;
  status:          string;
  severity:        string;
  source_platform: string;
};

// ─── Causal diagnosis (deterministic, no AI call) ─────────────────────────────

function deriveProbableCauses(
  zeroConvCampaigns: CampaignRow[],
  ga4Sessions:       number,
  govFindings:       GovFindingRow[],
): ProbableCause[] {
  if (zeroConvCampaigns.length === 0) return [];

  const causes: ProbableCause[] = [];

  const totalClicks = zeroConvCampaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
  const ctrs        = zeroConvCampaigns
    .map((c) => parseFloat(String(c.ctr)) || 0)
    .filter((v) => v > 0);
  const avgCtr      = ctrs.length > 0 ? ctrs.reduce((s, v) => s + v, 0) / ctrs.length : 0;

  // 1. Tracking: GA4 sessions = 0 but Ads clicks registered
  if (ga4Sessions === 0 && totalClicks > 0) {
    causes.push({
      confidence: "high",
      layer:      "tracking",
      cause:      "Tracking quebrado",
      evidence:   `GA4 sessions = 0, Ads clicks = ${totalClicks}`,
    });
  }

  // 2. Creative: average CTR < 0.5%
  if (avgCtr > 0 && avgCtr < 0.005) {
    causes.push({
      confidence: avgCtr < 0.002 ? "high" : "medium",
      layer:      "creative",
      cause:      "Copy/criativo fraco",
      evidence:   `CTR médio = ${(avgCtr * 100).toFixed(2)}% (limiar: 0.5%)`,
    });
  }

  // 3. Governance: failed or critical/high GA4 checks
  const badGov = govFindings.filter(
    (f) =>
      (f.status === "failed" || f.severity === "critical" || f.severity === "high") &&
      f.source_platform === "ga4",
  );
  if (badGov.length > 0) {
    causes.push({
      confidence: "medium",
      layer:      "tracking",
      cause:      "Anomalia de governance GA4",
      evidence:   `${badGov.length} check(s) falhado(s): ${badGov[0].check_name}`,
    });
  }

  // 4. Fallback: landing page
  if (causes.length === 0 && totalClicks > 0) {
    causes.push({
      confidence: "low",
      layer:      "landing",
      cause:      "Possível problema na landing page",
      evidence:   `${totalClicks} cliques registados, 0 conversões`,
    });
  }

  return causes;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = await createClient();

    const workspace = await resolveWorkspace(supabase);
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── Fetch all context data in parallel ───────────────────────────────────
    const [dbResult, campaignResult, ga4Result, govResult] = await Promise.all([
      supabase
        .from("agent_decisions")
        .select("id, agent_id, type, title, body, rationale, impact_value, status, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(50),

      supabase
        .from("campaign_summary")
        .select("campaign_name, cost, conversions, roas, clicks, ctr")
        .eq("workspace_id", workspace.id)
        .order("date_range_end", { ascending: false })
        .order("loaded_at",      { ascending: false })
        .limit(100),

      supabase
        .from("ga4_first_light_summary")
        .select("sessions")
        .eq("workspace_id", workspace.id)
        .order("date_range_end", { ascending: false })
        .limit(1),

      supabase
        .from("semantic_governance_findings")
        .select("check_name, status, severity, source_platform")
        .eq("workspace_id", workspace.id)
        .in("status", ["failed", "warning"])
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // ── Build shared causal context ───────────────────────────────────────────
    const ga4Sessions  = (ga4Result.data?.[0]?.sessions as number) ?? 0;
    const govFindings: GovFindingRow[] = (govResult.data ?? []) as GovFindingRow[];

    // Deduplicate campaign rows — keep most recent per campaign
    const seen = new Set<string>();
    const campaignRows: CampaignRow[] = [];
    for (const row of campaignResult.data ?? []) {
      if (!seen.has(row.campaign_name)) {
        seen.add(row.campaign_name);
        campaignRows.push(row as CampaignRow);
      }
    }

    const zeroConvCampaigns = campaignRows.filter(
      (c) => parseFloat(String(c.cost)) > 0 && parseFloat(String(c.conversions)) === 0,
    );

    const probableCauses = deriveProbableCauses(zeroConvCampaigns, ga4Sessions, govFindings);

    // ── Primary path: persisted agent_decisions ───────────────────────────────
    const dbRows = dbResult.data ?? [];
    if (dbRows.length > 0) {
      const decisions: Decision[] = dbRows.map((row, idx) => {
        const d: Decision = {
          id:        idx + 1,
          dbId:      row.id as string,
          agentId:   row.agent_id as string,
          agentName: AGENT_NAMES[row.agent_id as string] ?? row.agent_id,
          type:      row.type as DecisionType,
          title:     row.title as string,
          body:      row.body as string,
          timestamp: fmtTime(row.created_at as string),
          status:    row.status as DecisionStatus,
          value:     row.impact_value as string | undefined,
          rationale: row.rationale as string | undefined,
        };
        // Attach causal diagnosis to alert decisions when evidence is available
        if (d.type === "alert" && probableCauses.length > 0) {
          d.probableCauses = probableCauses;
        }
        return d;
      });
      return NextResponse.json({ ok: true, data: decisions });
    }

    // ── Fallback: on-the-fly derivation ───────────────────────────────────────
    const [eventsResult] = await Promise.all([
      supabase
        .from("operational_events")
        .select("id, category, impact_scope, occurred_at")
        .eq("workspace_id", workspace.id)
        .eq("category", "kpi_anomaly")
        .order("occurred_at", { ascending: false })
        .limit(10),
    ]);

    const totalWaste = zeroConvCampaigns.reduce(
      (sum, c) => sum + (parseFloat(String(c.cost)) || 0), 0,
    );

    const decisions: Decision[] = [];
    let   idSeq = 1;
    const ts    = nowTime();

    if (zeroConvCampaigns.length > 0) {
      const names    = zeroConvCampaigns.map((c) => `${c.campaign_name} (R$${fmtBRL(parseFloat(String(c.cost)))})`);
      const listHead = names.slice(0, 5).join("; ");
      const overflow = names.length > 5 ? ` +${names.length - 5} mais` : "";
      const isCritical = totalWaste > 500;

      decisions.push({
        id:        idSeq++,
        agentId:   "anomaly-scout",
        agentName: "Anomaly Scout",
        type:      "alert",
        title:     `R$ ${fmtBRL(totalWaste)} em gasto sem conversão — ${zeroConvCampaigns.length} campanha${zeroConvCampaigns.length > 1 ? "s" : ""}`,
        body:      `Campanhas com spend > R$0 e conversões = 0 detectadas: ${listHead}${overflow}.`,
        timestamp: ts,
        status:    "pending",
        value:     `Waste total: R$ ${fmtBRL(totalWaste)}`,
        rationale: `Critério: spend > 0 AND conversions = 0. Classificação P1 — DRENO DE VERBA.${isCritical ? ` Total > R$500 → priority_score = 5 (CRÍTICO).` : ""}`,
        probableCauses: probableCauses.length > 0 ? probableCauses : undefined,
      });

      decisions.push({
        id:        idSeq++,
        agentId:   "anomaly-scout",
        agentName: "Anomaly Scout",
        type:      "suggestion",
        title:     `Pausar ${zeroConvCampaigns.length} campanha${zeroConvCampaigns.length > 1 ? "s" : ""} com zero conversão`,
        body:      `Recomendação: pausar as ${zeroConvCampaigns.length} campanhas identificadas até revisão de estratégia e realinhamento de público. Sujeito à aprovação do gestor.`,
        timestamp: ts,
        status:    "pending",
        value:     `Economia estimada: R$ ${fmtBRL(totalWaste)}/período`,
        rationale: "PROIBIDO — Execução: output é advisory only. Nenhuma campanha pode ser pausada sem aprovação explícita do gestor.",
      });
    }

    for (const evt of eventsResult.data ?? []) {
      const scope = (evt.impact_scope ?? {}) as Record<string, unknown>;
      const metric   = String(scope.metric ?? "roas").toUpperCase();
      const devPct   = typeof scope.deviation_pct === "number" ? scope.deviation_pct : 0;
      const lastVal  = typeof scope.last_value    === "number" ? scope.last_value.toFixed(2)  : "—";
      const meanVal  = typeof scope.mean_value    === "number" ? scope.mean_value.toFixed(2)  : "—";
      const lookback = typeof scope.lookback_days === "number" ? scope.lookback_days : 30;
      const sign     = devPct >= 0 ? "+" : "";

      decisions.push({
        id:        idSeq++,
        agentId:   "anomaly-scout",
        agentName: "Anomaly Scout",
        type:      "alert",
        title:     `Anomalia de ${metric} — ${sign}${devPct.toFixed(1)}% vs média ${lookback}d`,
        body:      `${metric} observado: ${lastVal}x. Média dos últimos ${lookback} dias: ${meanVal}x. Desvio de ${sign}${devPct.toFixed(1)}% ultrapassa o limiar de ±30%.`,
        timestamp: fmtTime(evt.occurred_at),
        status:    "pending",
        value:     `Desvio: ${sign}${devPct.toFixed(1)}%`,
        rationale: `Detector: méd${lookback}d = ${meanVal}. Último valor = ${lastVal}. Limiar configurado: ±30%.`,
      });
    }

    return NextResponse.json({ ok: true, data: decisions });

  } catch (err) {
    console.error("[agents/decisions] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}
