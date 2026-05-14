"use client";
import { useEffect, useState, useMemo } from "react";
import {
  AreaChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, ReferenceLine,
} from "recharts";
import {
  Loader2, CheckCircle2, ShieldCheck, Activity, Database,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { AINarrativeCard, type KpiContext } from "@/components/AINarrativeCard";
import { computeDecisionBrief, type Ga4DecisionInput } from "@/lib/decision";
import {
  computeHealth, latestPerExpectedSource, timeAgo, EXPECTED_SOURCES,
  type SyncRun,
} from "@/lib/api/sync_runs";
import { isSuspiciousEventName } from "@/lib/funnel";

// ─── Types ────────────────────────────────────────────────────────────────────

type DomainStatus = "saudável" | "atenção" | "risco" | "sem dados";

interface MinInsight {
  insight_type:      string;
  status:            string;
  evidence?:         Record<string, unknown> | null;
  dedupe_key?:       string | null;
  date_range_start?: string | null;
}

interface DQCheck {
  check_name: string;
  status:     "passed" | "warning" | "failed";
  checked_at: string;
}

interface KpiRow     { date: string; metric_name: string; metric_value: number; }
interface ChartPoint { date: string; roas: number; spend: number; }

interface CampSummaryRow {
  campaign_id: string;
  cost:        number;
  clicks:      number;
  ctr:         number; // decimal
}

type MarkerType = "sync" | "governance" | "insight" | "anomaly";
interface ChartMarker { date: string; type: MarkerType; }

interface AnomalyEvent {
  category:     string;
  title:        string;
  description:  string | null;
  impact_scope: Record<string, unknown> | null;
  occurred_at:  string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WASTE_TYPES = [
  "campaign_zero_conversions_with_cost",
  "keyword_zero_conversions_with_cost",
];

const CONVERSION_EVENTS = new Set([
  "mentor_signup_success",
  "user_signup_mentor_with_auto_signin",
]);

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRLCompact(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1).replace(".", ",")}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

function fmtN(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".", ",") + "k";
  return n.toLocaleString("pt-BR");
}

function fmtPct(ratio: number | null): string {
  if (ratio === null) return "—";
  return (ratio * 100).toFixed(1).replace(".", ",") + "%";
}

function fmtDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1).replace(".", ",")}%`;
}

function dedupeInsights(items: MinInsight[]): MinInsight[] {
  const map = new Map<string, MinInsight>();
  for (const ins of items) {
    const key  = ins.dedupe_key ?? ins.insight_type;
    const prev = map.get(key);
    if (!prev || (ins.date_range_start ?? "") > (prev.date_range_start ?? "")) {
      map.set(key, ins);
    }
  }
  return [...map.values()];
}

function latestChecksByName(checks: DQCheck[]): DQCheck[] {
  const map = new Map<string, DQCheck>();
  for (const c of checks) {
    const ex = map.get(c.check_name);
    if (!ex || c.checked_at > ex.checked_at) map.set(c.check_name, c);
  }
  return [...map.values()];
}

function pivotChart(rows: KpiRow[]): ChartPoint[] {
  const map: Record<string, ChartPoint> = {};
  for (const r of rows) {
    if (!map[r.date]) map[r.date] = { date: r.date, roas: 0, spend: 0 };
    if (r.metric_name === "roas")       map[r.date].roas  = r.metric_value;
    if (r.metric_name === "total_cost") map[r.date].spend = r.metric_value;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Domain health heuristics ─────────────────────────────────────────────────

function funnelDomainHealth(ga4: Ga4DecisionInput | null): { status: DomainStatus; qualifier: string } {
  if (!ga4 || ga4.sessions === 0) return { status: "sem dados", qualifier: "sem dados de sessão" };
  const formStart  = ga4.top_events.find(e => e.event_name.toLowerCase() === "form_start")?.count ?? 0;
  const intentRate = formStart / ga4.sessions;
  return {
    status:    intentRate > 0.20 ? "saudável" : "atenção",
    qualifier: `${fmtN(ga4.sessions)} sessões · ${fmtPct(intentRate)} intenção`,
  };
}

function conversionDomainHealth(insights: MinInsight[]): { status: DomainStatus; qualifier: string } {
  const waste = insights
    .filter(i => WASTE_TYPES.includes(i.insight_type))
    .reduce((sum, i) => sum + (typeof i.evidence?.cost === "number" ? i.evidence.cost : 0), 0);
  if (waste > 500) return { status: "risco",    qualifier: `${formatBRL(waste)} sem conversão` };
  if (waste > 100) return { status: "atenção",  qualifier: `${formatBRL(waste)} sem conversão` };
  return               { status: "saudável", qualifier: "sem desperdício identificado" };
}

function trackingDomainHealth(
  ga4:      Ga4DecisionInput | null,
  insights: MinInsight[],
): { status: DomainStatus; qualifier: string } {
  if (!ga4 || ga4.top_events.length === 0) return { status: "sem dados", qualifier: "sem dados GA4" };
  const total      = ga4.top_events.reduce((s, e) => s + e.count, 0);
  const suspicious = ga4.top_events.filter(e => isSuspiciousEventName(e.event_name)).reduce((s, e) => s + e.count, 0);
  const share      = total > 0 ? suspicious / total : 0;
  const qualifier  = `${fmtPct(share)} eventos suspeitos`;
  const hasReview  = insights.some(i => i.insight_type === "ads_conversion_action_semantic_review_required");
  if (share > 0.20)              return { status: "risco",    qualifier };
  if (share > 0.10 || hasReview) return { status: "atenção",  qualifier };
  return                              { status: "saudável",  qualifier };
}

function governanceDomainHealth(latest: DQCheck[]): { status: DomainStatus; qualifier: string } {
  if (latest.length === 0) return { status: "sem dados", qualifier: "sem runs de governance" };
  const failed  = latest.filter(c => c.status === "failed").length;
  const warning = latest.filter(c => c.status === "warning").length;
  if (failed > 0)  return { status: "risco",    qualifier: `${failed} check${failed !== 1 ? "s" : ""} com falha` };
  if (warning > 0) return { status: "atenção",  qualifier: `${warning} check${warning !== 1 ? "s" : ""} em aviso` };
  return               { status: "saudável", qualifier: `${latest.length} checks ok` };
}

function syncDomainHealth(runs: SyncRun[]): { status: DomainStatus; qualifier: string } {
  const latestMap = latestPerExpectedSource(runs);
  const h         = computeHealth(latestMap);
  const ok        = EXPECTED_SOURCES.filter(s => latestMap[s]?.status === "success").length;
  const latest    = runs[0];
  const ago       = latest ? timeAgo(latest.finished_at ?? latest.started_at) : "";
  const qualifier = latest ? `${ok}/${EXPECTED_SOURCES.length} fontes · ${ago}` : "sem dados";
  if (h === "healthy") return { status: "saudável",  qualifier };
  if (h === "warning") return { status: "atenção",   qualifier };
  if (h === "error")   return { status: "risco",     qualifier };
  return                    { status: "sem dados", qualifier: "sem dados de sync" };
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<DomainStatus, { dot: string; text: string; label: string }> = {
  "saudável":  { dot: "bg-emerald-500", text: "text-emerald-400", label: "Saudável"  },
  "atenção":   { dot: "bg-amber-400",   text: "text-amber-400",   label: "Atenção"   },
  "risco":     { dot: "bg-orange-500",  text: "text-orange-400",  label: "Risco"     },
  "sem dados": { dot: "bg-zinc-600",    text: "text-zinc-500",    label: "Sem dados" },
};

const MARKER_STYLE: Record<MarkerType, { stroke: string; letter: string }> = {
  sync:       { stroke: "#52525b", letter: "S" },
  governance: { stroke: "#b45309", letter: "G" },
  insight:    { stroke: "#6366f1", letter: "I" },
  anomaly:    { stroke: "#f97316", letter: "!" },
};

const URGENCY_BORDER: Record<string, string> = {
  high:   "border-l-amber-500",
  medium: "border-l-zinc-600/60",
  low:    "border-l-zinc-700/40",
};

const URGENCY_TEXT: Record<string, string> = {
  high:   "text-amber-300/90",
  medium: "text-zinc-300",
  low:    "text-zinc-400",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MomentumChartProps {
  data: ChartPoint[];
  trendDelta: number;
  isAnomaly: boolean;
  markers?: ChartMarker[];
}

function MomentumChart({ data, trendDelta, isAnomaly, markers }: MomentumChartProps) {
  const stroke    = trendDelta >= 0 ? "#10b981" : "#ef4444";
  const deltaFmt  = fmtDelta(trendDelta);
  const lastPoint = data.length > 0 ? data[data.length - 1] : null;

  if (data.length === 0) {
    return (
      <div className="h-[72px] flex items-center justify-center text-[9px] text-zinc-700 font-mono">
        sem dados no período
      </div>
    );
  }

  if (data.length === 1) {
    return (
      <div className="h-[72px] flex flex-col items-center justify-center gap-0.5">
        <span className="text-[9px] text-zinc-600 font-mono">1 dia disponível · gráfico requer ≥ 2 dias</span>
        <span className="text-[9px] text-zinc-700 font-mono">{data[0].date} · ROAS {data[0].roas.toFixed(2).replace(".", ",")}x</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={72}>
      <AreaChart data={data} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="exec-pulse-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={stroke} stopOpacity={0.13} />
            <stop offset="95%" stopColor={stroke} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={false} axisLine={{ stroke: "#27272a" }} tickLine={false} />
        <YAxis yAxisId="roas"  hide domain={["auto", "auto"]} />
        <YAxis yAxisId="spend" hide domain={["auto", "auto"]} orientation="right" />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "3px 8px", fontSize: 10 }}
          itemStyle={{ color: "#a1a1aa", fontSize: 10 }}
          labelStyle={{ color: "#71717a", fontSize: 9 }}
          formatter={(v, name) => {
            if (name === "spend") return [fmtBRLCompact(Number(v)), "Custo"];
            return [`${Number(v).toFixed(2).replace(".", ",")}x  ·  Δ ${deltaFmt}`, "ROAS"];
          }}
          labelFormatter={(lbl) => {
            const parts = String(lbl).split("-");
            return `${parts[2]}/${parts[1]}`;
          }}
        />
        {markers?.map((m, i) => (
          <ReferenceLine
            key={`${m.type}-${i}`}
            x={m.date}
            stroke={MARKER_STYLE[m.type].stroke}
            strokeWidth={1}
            strokeDasharray="3 2"
            label={{
              value: MARKER_STYLE[m.type].letter,
              position: "insideTopLeft",
              fontSize: 7,
              fill: MARKER_STYLE[m.type].stroke,
            }}
          />
        ))}
        {isAnomaly && lastPoint && (
          <ReferenceDot
            yAxisId="roas"
            x={lastPoint.date}
            y={lastPoint.roas}
            r={4}
            fill={stroke}
            stroke="#18181b"
            strokeWidth={1.5}
          />
        )}
        <Line
          yAxisId="spend"
          type="monotone"
          dataKey="spend"
          stroke="#52525b"
          strokeWidth={1}
          dot={false}
          activeDot={{ r: 2, strokeWidth: 0, fill: "#71717a" }}
        />
        <Area
          yAxisId="roas"
          type="monotone"
          dataKey="roas"
          stroke={stroke}
          strokeWidth={1.5}
          fill="url(#exec-pulse-grad)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: stroke }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PulseMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium text-zinc-700 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-lg font-bold text-zinc-100 leading-none font-mono">{value}</p>
    </div>
  );
}

function DomainRow({ label, status, qualifier }: { label: string; status: DomainStatus; qualifier: string }) {
  const s = STATUS_STYLE[status];
  return (
    <div className="px-4 py-1.5 flex items-center gap-3">
      <span className="text-[11px] text-zinc-500 w-24 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
        <span className={`text-[11px] font-medium ${s.text}`}>{s.label}</span>
      </div>
      <span className="text-[10px] text-zinc-600 ml-auto font-mono truncate max-w-[160px]">{qualifier}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveBoardView({ workspaceId }: { workspaceId: string }) {
  const supabase = createClient();

  const [insights, setInsights] = useState<MinInsight[]>([]);
  const [ga4,      setGa4]      = useState<Ga4DecisionInput | null>(null);
  const [dqChecks, setDqChecks] = useState<DQCheck[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [kpiRows,        setKpiRows]        = useState<KpiRow[]>([]);
  const [anomalyEvents,  setAnomalyEvents]  = useState<AnomalyEvent[]>([]);
  const [campSummaryRows, setCampSummaryRows] = useState<CampSummaryRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<7 | 15 | 30>(30);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      const [insightRes, ga4Res, dqRes, syncRes, kpiRes, anomalyRes, campSummaryRes] = await Promise.all([
        supabase
          .from("insight_feed")
          .select("insight_type, status, evidence, dedupe_key, date_range_start")
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("ga4_first_light_summary")
          .select("sessions, top_events")
          .eq("workspace_id", workspaceId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("data_quality_report")
          .select("check_name, status, checked_at")
          .eq("workspace_id", workspaceId)
          .order("checked_at", { ascending: false })
          .limit(200),
        supabase
          .from("sync_runs")
          .select("data_source, status, started_at, finished_at")
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false })
          .limit(20),
        supabase
          .from("kpi_cache_daily")
          .select("date, metric_name, metric_value")
          .eq("workspace_id", workspaceId)
          .in("metric_name", ["roas", "total_cost", "conversions"])
          .gte("date", sinceDate(30))
          .order("date", { ascending: true }),
        supabase
          .from("operational_events")
          .select("category, title, description, impact_scope, occurred_at")
          .eq("workspace_id", workspaceId)
          .eq("category", "kpi_anomaly")
          .order("occurred_at", { ascending: false })
          .limit(30),
        supabase
          .from("campaign_summary")
          .select("campaign_id, cost, clicks, ctr")
          .eq("workspace_id", workspaceId)
          .eq("is_mock", false)
          .order("date_range_end", { ascending: false })
          .order("cost",           { ascending: false })
          .limit(100),
      ]);

      setInsights(dedupeInsights((insightRes.data as MinInsight[]) ?? []));

      if (ga4Res.data) {
        setGa4({
          sessions:   typeof ga4Res.data.sessions === "number" ? ga4Res.data.sessions : 0,
          top_events: Array.isArray(ga4Res.data.top_events)
            ? (ga4Res.data.top_events as Ga4DecisionInput["top_events"])
            : [],
        });
      }

      if (cancelled) return;
      setDqChecks((dqRes.data  as DQCheck[])  ?? []);
      setSyncRuns((syncRes.data as SyncRun[])  ?? []);
      setKpiRows(     (kpiRes.data     as KpiRow[])      ?? []);
      setAnomalyEvents((anomalyRes.data as AnomalyEvent[]) ?? []);

      const seenCamp = new Set<string>();
      const campDeduped: CampSummaryRow[] = [];
      for (const row of (campSummaryRes.data ?? []) as CampSummaryRow[]) {
        if (!seenCamp.has(row.campaign_id)) {
          seenCamp.add(row.campaign_id);
          campDeduped.push(row);
        }
      }
      setCampSummaryRows(campDeduped);

      setLoading(false);
    }
    void loadAll();
    return () => { cancelled = true; };
  }, [workspaceId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const priorities    = useMemo(() => computeDecisionBrief(insights, ga4), [insights, ga4]);
  const latestDq      = useMemo(() => latestChecksByName(dqChecks), [dqChecks]);
  const latestSyncMap = useMemo(() => latestPerExpectedSource(syncRuns), [syncRuns]);
  const chartData   = useMemo(() => pivotChart(kpiRows), [kpiRows]);
  const periodData  = useMemo(() => chartData.slice(-selectedPeriod), [chartData, selectedPeriod]);

  const avgRoas = useMemo(() => {
    const valid = periodData.filter(d => d.roas > 0);
    if (valid.length === 0) return null;
    return valid.reduce((s, d) => s + d.roas, 0) / valid.length;
  }, [periodData]);

  const totalSpend = useMemo(() => {
    const valid = periodData.filter(d => d.spend > 0);
    if (valid.length === 0) return null;
    return valid.reduce((s, d) => s + d.spend, 0);
  }, [periodData]);

  const { trendDelta, isAnomaly } = useMemo(() => {
    const valid = periodData.filter(d => d.roas > 0);
    if (valid.length < 2) return { trendDelta: 0, isAnomaly: false };
    const avgPeriod = valid.reduce((s, d) => s + d.roas, 0) / valid.length;
    const lastRoas  = valid[valid.length - 1].roas;
    const anomaly   = avgPeriod > 0 && Math.abs(lastRoas - avgPeriod) / avgPeriod > 0.30;
    const half      = Math.max(Math.floor(valid.length / 2), 1);
    if (valid.length < 4) return { trendDelta: 0, isAnomaly: anomaly };
    const last    = valid.slice(-half);
    const prev    = valid.slice(-half * 2, -half);
    const avgLast = last.reduce((s, d) => s + d.roas, 0) / last.length;
    const avgPrev = prev.length > 0
      ? prev.reduce((s, d) => s + d.roas, 0) / prev.length
      : avgLast;
    const delta   = avgPrev > 0 ? ((avgLast - avgPrev) / avgPrev) * 100 : 0;
    return { trendDelta: delta, isAnomaly: anomaly };
  }, [periodData]);

  const wasteAmount = useMemo(() =>
    insights
      .filter(i => WASTE_TYPES.includes(i.insight_type))
      .reduce((sum, i) => sum + (typeof i.evidence?.cost === "number" ? i.evidence.cost : 0), 0),
    [insights],
  );

  const chartMarkers = useMemo((): ChartMarker[] => {
    const periodDates = new Set(periodData.map(d => d.date));
    const result: ChartMarker[] = [];
    const seen   = new Set<string>();

    function tryAdd(ts: string | null | undefined, type: MarkerType) {
      if (!ts) return;
      const date = ts.split("T")[0];
      if (periodDates.has(date) && !seen.has(date)) {
        result.push({ date, type });
        seen.add(date);
      }
    }

    const latestSync = syncRuns[0];
    tryAdd(latestSync?.finished_at ?? latestSync?.started_at, "sync");
    tryAdd(dqChecks[0]?.checked_at, "governance");
    tryAdd(insights.find(i => i.date_range_start)?.date_range_start, "insight");
    anomalyEvents.forEach(ev => tryAdd(ev.occurred_at, "anomaly"));

    return result;
  }, [periodData, syncRuns, dqChecks, insights, anomalyEvents]);

  const { sessions, convRate, suspShare } = useMemo(() => {
    if (!ga4 || ga4.sessions === 0) {
      return { sessions: 0, convRate: null, suspShare: null };
    }
    const convCount = ga4.top_events
      .filter(e => CONVERSION_EVENTS.has(e.event_name.toLowerCase()))
      .reduce((s, e) => s + e.count, 0);
    const totalEvts = ga4.top_events.reduce((s, e) => s + e.count, 0);
    const suspCount = ga4.top_events.filter(e => isSuspiciousEventName(e.event_name)).reduce((s, e) => s + e.count, 0);
    return {
      sessions:   ga4.sessions,
      convRate:   convCount / ga4.sessions,
      suspShare:  totalEvts > 0 ? suspCount / totalEvts : 0,
    };
  }, [ga4]);

  // ── Campaign-level KPI aggregates (for AINarrativeCard) ──────────────────

  const totalConversions = useMemo(() => {
    const dates = new Set(periodData.map(d => d.date));
    const total = kpiRows
      .filter(r => r.metric_name === "conversions" && dates.has(r.date))
      .reduce((s, r) => s + r.metric_value, 0);
    return total > 0 ? Math.round(total) : null;
  }, [kpiRows, periodData]);

  const totalClicks = useMemo(() => {
    const total = campSummaryRows.reduce((s, r) => s + (r.clicks ?? 0), 0);
    return total > 0 ? total : null;
  }, [campSummaryRows]);

  const cpc = useMemo(() => {
    if (totalSpend === null || totalClicks === null || totalClicks === 0) return null;
    return totalSpend / totalClicks;
  }, [totalSpend, totalClicks]);

  const avgCtr = useMemo(() => {
    const totalCost = campSummaryRows.reduce((s, r) => s + (r.cost ?? 0), 0);
    if (totalCost === 0) return null;
    const weighted = campSummaryRows.reduce((s, r) => s + (r.ctr ?? 0) * (r.cost ?? 0), 0);
    return weighted / totalCost;
  }, [campSummaryRows]);

  const narrativeKpi: KpiContext = {
    roas:             avgRoas,
    trendDelta,
    totalSpend,
    totalConversions,
    cpc,
    ctr:              avgCtr,
  };

  const sourcesOk   = EXPECTED_SOURCES.filter(s => latestSyncMap[s]?.status === "success").length;
  const latestSyncRun = syncRuns[0] ?? null;
  const syncTimeAgo = latestSyncRun ? timeAgo(latestSyncRun.finished_at ?? latestSyncRun.started_at) : "—";
  const latestGovAt = dqChecks[0]?.checked_at ?? null;
  const newInsights = insights.filter(i => i.status === "new").length;
  const govWarnings = latestDq.filter(c => c.status === "warning" || c.status === "failed").length;

  // ── Domain statuses ───────────────────────────────────────────────────────

  const funnelRow     = useMemo(() => funnelDomainHealth(ga4),            [ga4]);
  const conversionRow = useMemo(() => conversionDomainHealth(insights),    [insights]);
  const trackingRow   = useMemo(() => trackingDomainHealth(ga4, insights), [ga4, insights]);
  const governanceRow = useMemo(() => governanceDomainHealth(latestDq),    [latestDq]);
  const syncRow       = useMemo(() => syncDomainHealth(syncRuns),          [syncRuns]);

  const domainRows: Array<{ label: string; status: DomainStatus; qualifier: string }> = [
    { label: "Funil",      ...funnelRow      },
    { label: "Conversão",  ...conversionRow  },
    { label: "Tracking",   ...trackingRow    },
    { label: "Governance", ...governanceRow  },
    { label: "Sync",       ...syncRow        },
  ];

  const domainStatuses = domainRows.map(d => d.status);
  const overallStatus: DomainStatus =
    domainStatuses.includes("risco")   ? "risco"     :
    domainStatuses.includes("atenção") ? "atenção"   :
    domainStatuses.every(s => s === "sem dados") ? "sem dados" : "saudável";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* 0 ── Executive Insight — AI diagnostic */}
      <AINarrativeCard kpi={narrativeKpi} workspaceId={workspaceId} />

      {/* 1 ── Saúde Operacional — compact status strip ───────────────────── */}
      <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-1.5 mr-2">
          <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Saúde:</p>
          <div className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[overallStatus].dot}`} />
          <span className={`text-[11px] font-semibold ${STATUS_STYLE[overallStatus].text}`}>
            {STATUS_STYLE[overallStatus].label}
          </span>
        </div>
        <div className="w-px h-3.5 bg-zinc-800/80 shrink-0" />
        {domainRows.map(({ label, status }) => {
          const s = STATUS_STYLE[status];
          return (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
              <span className="text-[11px] text-zinc-500">{label}:</span>
              <span className={`text-[11px] font-medium ${s.text}`}>{s.label}</span>
            </div>
          );
        })}
      </div>

      {/* 2 ── Prioridades (3/5) + Performance Pulse (2/5) ───────────────── */}
      <div className="grid grid-cols-5 gap-3">

        {/* Prioridades */}
        <div className="col-span-3 bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-800/40">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Prioridades</p>
          </div>
          {priorities.length === 0 ? (
            <div className="px-4 py-3 flex items-center gap-2 text-xs text-zinc-600">
              <CheckCircle2 size={12} className="text-emerald-500/40" />
              Nenhuma prioridade crítica identificada no período.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/30">
              {priorities.slice(0, 3).map((s, i) => (
                <div key={i} className={`px-4 py-2.5 border-l-2 ${URGENCY_BORDER[s.urgency]}`}>
                  <p className={`text-xs leading-relaxed ${URGENCY_TEXT[s.urgency]}`}>{s.statement}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{s.direction}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Performance Pulse */}
        <div className="col-span-2 bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 border-b border-zinc-800/40 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Performance Pulse</p>
            <div className="flex items-center gap-2">
              {periodData.length > 1 && (
                <span className={`text-[10px] font-mono font-semibold ${trendDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  Δ {fmtDelta(trendDelta)}
                </span>
              )}
              <div className="flex items-center gap-0.5">
                {([7, 15, 30] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedPeriod(p)}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                      selectedPeriod === p
                        ? "bg-zinc-700 text-zinc-300"
                        : "text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    {p}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4 key metrics — escala × investimento × eficiência */}
          <div className="px-4 pt-2.5 pb-1.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
            <PulseMetric label="Sessões"      value={sessions > 0 ? fmtN(sessions) : "—"} />
            <PulseMetric label="Investimento" value={totalSpend !== null ? fmtBRLCompact(totalSpend) : "—"} />
            <PulseMetric label="Conversão"    value={fmtPct(convRate)} />
            <PulseMetric label="ROAS"         value={avgRoas !== null ? `${avgRoas.toFixed(2).replace(".", ",")}x` : "—"} />
          </div>

          {/* Momentum Chart — ROAS trend com delta e anomalia */}
          <div className="px-2 flex-1">
            <MomentumChart
              data={periodData}
              trendDelta={trendDelta}
              isAnomaly={isAnomaly}
              markers={chartMarkers}
            />
          </div>

          {/* Footer context */}
          <div className="px-4 py-2 border-t border-zinc-800/30 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full ${wasteAmount > 100 ? "bg-amber-400/70" : "bg-zinc-600"}`} />
              <span className="text-[10px] text-zinc-600">
                Waste: {wasteAmount > 0 ? formatBRL(wasteAmount) : "R$ 0"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-zinc-600" />
              <span className="text-[10px] text-zinc-600">Sync: {syncTimeAgo}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full ${periodData.length >= 7 ? "bg-zinc-600" : "bg-amber-500/50"}`} />
              <span className={`text-[10px] font-mono ${periodData.length >= 7 ? "text-zinc-600" : "text-amber-600/70"}`}>
                {periodData.length}d histórico
              </span>
            </div>
            {suspShare !== null && (
              <span className="text-[10px] text-zinc-700 ml-auto font-mono">
                Track: {fmtPct(suspShare)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3 ── Domain Health (1/2) + Timeline (1/2) ──────────────────────── */}
      <div className="grid grid-cols-2 gap-3">

        {/* Domain Health */}
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-800/40">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Saúde por Domínio</p>
          </div>
          <div className="divide-y divide-zinc-800/30">
            {domainRows.map(row => (
              <DomainRow key={row.label} label={row.label} status={row.status} qualifier={row.qualifier} />
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-zinc-800/40 flex items-center justify-between">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Timeline Operacional</p>
            {anomalyEvents.length > 0 && (
              <span className="text-[9px] font-mono text-orange-400/80 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
                {anomalyEvents.length} anomalia{anomalyEvents.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="divide-y divide-zinc-800/30">
            <div className="px-4 py-1.5 flex items-center gap-3">
              <Database    size={11} className="text-zinc-700 shrink-0" />
              <span className="text-[11px] text-zinc-500 w-24 shrink-0">Sync</span>
              <span className="text-[11px] text-zinc-300 font-mono">{syncTimeAgo}</span>
              <span className="text-[10px] text-zinc-600 ml-auto font-mono">
                {latestSyncRun ? `${sourcesOk}/${EXPECTED_SOURCES.length} fontes` : "sem dados"}
              </span>
            </div>
            <div className="px-4 py-1.5 flex items-center gap-3">
              <ShieldCheck size={11} className="text-zinc-700 shrink-0" />
              <span className="text-[11px] text-zinc-500 w-24 shrink-0">Governance</span>
              <span className="text-[11px] text-zinc-300 font-mono">
                {latestGovAt ? timeAgo(latestGovAt) : "—"}
              </span>
              <span className="text-[10px] text-zinc-600 ml-auto font-mono">
                {latestDq.length > 0
                  ? `${latestDq.length} checks · ${govWarnings > 0 ? `${govWarnings} em aviso` : "todos ok"}`
                  : "sem dados"}
              </span>
            </div>
            <div className="px-4 py-1.5 flex items-center gap-3">
              <Activity    size={11} className="text-zinc-700 shrink-0" />
              <span className="text-[11px] text-zinc-500 w-24 shrink-0">Insights</span>
              <span className={`text-[11px] font-mono ${newInsights > 0 ? "text-blue-400" : "text-zinc-300"}`}>
                {newInsights > 0 ? `${newInsights} novo${newInsights !== 1 ? "s" : ""}` : "nenhum novo"}
              </span>
              <span className="text-[10px] text-zinc-600 ml-auto font-mono">
                {insights.length} sinais únicos
              </span>
            </div>
            {anomalyEvents.slice(0, 3).map((ev, i) => {
              const scope   = ev.impact_scope ?? {};
              const dev     = typeof scope.deviation_pct === "number" ? scope.deviation_pct : 0;
              const last    = typeof scope.last_value    === "number" ? scope.last_value    : 0;
              const mean    = typeof scope.mean_value    === "number" ? scope.mean_value    : 0;
              const days    = typeof scope.lookback_days === "number" ? scope.lookback_days : 30;
              const sign    = dev >= 0 ? "+" : "";
              const dateStr = ev.occurred_at.split("T")[0].split("-").reverse().slice(0, 2).join("/");
              const tooltip = `ROAS ${sign}${dev.toFixed(1)}% vs média ${days}d · último: ${last.toFixed(2)}x · média: ${mean.toFixed(2)}x`;
              return (
                <div
                  key={i}
                  className="group relative px-4 py-1.5 flex items-center gap-3 hover:bg-orange-500/5 transition-colors cursor-default"
                  title={tooltip}
                >
                  <span className="text-[10px] font-bold text-orange-400 shrink-0 w-3 text-center">!</span>
                  <span className="text-[11px] text-zinc-500 w-24 shrink-0 truncate">Anomalia</span>
                  <span className="text-[11px] text-orange-300/80 font-mono truncate">
                    {sign}{dev.toFixed(1)}% ROAS
                  </span>
                  <span className="text-[10px] text-zinc-600 ml-auto font-mono shrink-0">{dateStr}</span>
                  {/* Hover tooltip */}
                  <div className="pointer-events-none absolute bottom-full left-4 mb-1.5 hidden group-hover:flex flex-col gap-0.5 bg-zinc-900 border border-zinc-700/80 rounded-lg px-3 py-2 z-20 shadow-xl min-w-[220px]">
                    <span className="text-[10px] font-semibold text-orange-400 mb-1">{ev.title}</span>
                    <span className="text-[9px] text-zinc-400 font-mono">Desvio:&nbsp;
                      <span className={dev >= 0 ? "text-emerald-400" : "text-red-400"}>{sign}{dev.toFixed(1)}%</span>
                    </span>
                    <span className="text-[9px] text-zinc-400 font-mono">Último:&nbsp;<span className="text-zinc-200">{last.toFixed(2)}x</span></span>
                    <span className="text-[9px] text-zinc-400 font-mono">Média {days}d:&nbsp;<span className="text-zinc-200">{mean.toFixed(2)}x</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
