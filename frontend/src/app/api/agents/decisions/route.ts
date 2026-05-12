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

interface Decision {
  id:        number;
  dbId?:     string;
  agentId:   string;
  agentName: string;
  type:      DecisionType;
  title:     string;
  body:      string;
  timestamp: string;
  status:    DecisionStatus;
  value?:    string;
  query?:    string;
  rationale?: string;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const supabase = await createClient();

    const workspace = await resolveWorkspace(supabase);
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── Try persisted agent_decisions first ──────────────────────────────────
    const { data: dbRows } = await supabase
      .from("agent_decisions")
      .select("id, agent_id, type, title, body, rationale, impact_value, status, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (dbRows && dbRows.length > 0) {
      const decisions: Decision[] = dbRows.map((row, idx) => ({
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
      }));
      return NextResponse.json({ ok: true, data: decisions });
    }

    // ── Fallback: on-the-fly derivation from campaign_summary ────────────────
    const [campaignResult, eventsResult] = await Promise.all([
      supabase
        .from("campaign_summary")
        .select("campaign_name, cost, conversions")
        .eq("workspace_id", workspace.id)
        .order("date_range_end", { ascending: false })
        .order("loaded_at",      { ascending: false })
        .limit(100),
      supabase
        .from("operational_events")
        .select("id, category, impact_scope, occurred_at")
        .eq("workspace_id", workspace.id)
        .eq("category", "kpi_anomaly")
        .order("occurred_at", { ascending: false })
        .limit(10),
    ]);

    const seen = new Set<string>();
    const campaigns: Array<{ campaign_name: string; cost: number; conversions: number }> = [];
    for (const row of campaignResult.data ?? []) {
      if (!seen.has(row.campaign_name)) {
        seen.add(row.campaign_name);
        campaigns.push({
          campaign_name: row.campaign_name,
          cost:          parseFloat(String(row.cost))        || 0,
          conversions:   parseFloat(String(row.conversions)) || 0,
        });
      }
    }

    const zeroConv   = campaigns.filter((c) => c.cost > 0 && c.conversions === 0);
    const totalWaste = zeroConv.reduce((sum, c) => sum + c.cost, 0);

    const decisions: Decision[] = [];
    let   idSeq = 1;
    const ts    = nowTime();

    if (zeroConv.length > 0) {
      const names    = zeroConv.map((c) => `${c.campaign_name} (R$${fmtBRL(c.cost)})`);
      const listHead = names.slice(0, 5).join("; ");
      const overflow = names.length > 5 ? ` +${names.length - 5} mais` : "";
      const isCritical = totalWaste > 500;

      decisions.push({
        id:        idSeq++,
        agentId:   "anomaly-scout",
        agentName: "Anomaly Scout",
        type:      "alert",
        title:     `R$ ${fmtBRL(totalWaste)} em gasto sem conversão — ${zeroConv.length} campanha${zeroConv.length > 1 ? "s" : ""}`,
        body:      `Campanhas com spend > R$0 e conversões = 0 detectadas: ${listHead}${overflow}.`,
        timestamp: ts,
        status:    "pending",
        value:     `Waste total: R$ ${fmtBRL(totalWaste)}`,
        rationale: `Critério: spend > 0 AND conversions = 0. Classificação P1 — DRENO DE VERBA.${isCritical ? ` Total > R$500 → priority_score = 5 (CRÍTICO).` : ""}`,
      });

      decisions.push({
        id:        idSeq++,
        agentId:   "anomaly-scout",
        agentName: "Anomaly Scout",
        type:      "suggestion",
        title:     `Pausar ${zeroConv.length} campanha${zeroConv.length > 1 ? "s" : ""} com zero conversão`,
        body:      `Recomendação: pausar as ${zeroConv.length} campanhas identificadas até revisão de estratégia e realinhamento de público. Sujeito à aprovação do gestor.`,
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
