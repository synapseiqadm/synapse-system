"use client";
import { useEffect, useState, useMemo } from "react";
import {
  AreaChart, Area, XAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Loader2, CheckCircle2, ShieldCheck, Activity, Database,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";
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

interface KpiRow    { date: string; metric_name: string; metric_value: number; }
interface ChartPoint { date: string; roas: number; }

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

function fmtN(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".", ",") + "k";
  return n.toLocaleString("pt-BR");
}

function fmtPct(ratio: number | null): string {
  if (ratio === null) return "—";
  return (ratio * 100).toFixed(1).replace(".", ",") + "%";
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
    if (!map[r.date]) map[r.date] = { date: r.date, roas: 0 };
    if (r.metric_name === "roas") map[r.date].roas = r.metric_value;
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

export function ExecutiveBoardView() {
  const supabase = createClient();

  const [insights, setInsights] = useState<MinInsight[]>([]);
  const [ga4,      setGa4]      = useState<Ga4DecisionInput | null>(null);
  const [dqChecks, setDqChecks] = useState<DQCheck[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [kpiRows,  setKpiRows]  = useState<KpiRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      const [insightRes, ga4Res, dqRes, syncRes, kpiRes] = await Promise.all([
        supabase
          .from("insight_feed")
          .select("insight_type, status, evidence, dedupe_key, date_range_start")
          .eq("workspace_id", DEFAULT_WORKSPACE.id)
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase
          .from("ga4_first_light_summary")
          .select("sessions, top_events")
          .eq("workspace_id", DEFAULT_WORKSPACE.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("data_quality_report")
          .select("check_name, status, checked_at")
          .eq("workspace_id", DEFAULT_WORKSPACE.id)
          .order("checked_at", { ascending: false })
          .limit(200),
        supabase
          .from("sync_runs")
          .select("data_source, status, started_at, finished_at")
          .eq("workspace_id", DEFAULT_WORKSPACE.id)
          .order("started_at", { ascending: false })
          .limit(20),
        supabase
          .from("kpi_cache_daily")
          .select("date, metric_name, metric_value")
          .eq("workspace_id", DEFAULT_WORKSPACE.id)
          .eq("metric_name", "roas")
          .gte("date", sinceDate(30))
          .order("date", { ascending: true }),
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

      setDqChecks((dqRes.data  as DQCheck[])  ?? []);
      setSyncRuns((syncRes.data as SyncRun[])  ?? []);
      setKpiRows( (kpiRes.data  as KpiRow[])   ?? []);
      setLoading(false);
    }
    loadAll();
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const priorities    = useMemo(() => computeDecisionBrief(insights, ga4), [insights, ga4]);
  const latestDq      = useMemo(() => latestChecksByName(dqChecks), [dqChecks]);
  const latestSyncMap = useMemo(() => latestPerExpectedSource(syncRuns), [syncRuns]);
  const chartData     = useMemo(() => pivotChart(kpiRows), [kpiRows]);

  const avgRoas = useMemo(() => {
    const valid = chartData.filter(d => d.roas > 0);
    if (valid.length === 0) return null;
    return valid.reduce((s, d) => s + d.roas, 0) / valid.length;
  }, [chartData]);

  const wasteAmount = useMemo(() =>
    insights
      .filter(i => WASTE_TYPES.includes(i.insight_type))
      .reduce((sum, i) => sum + (typeof i.evidence?.cost === "number" ? i.evidence.cost : 0), 0),
    [insights],
  );

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
            <span className="text-[9px] text-zinc-700 font-mono">últimos 30d</span>
          </div>

          {/* 3 key metrics */}
          <div className="px-4 pt-3 pb-2 grid grid-cols-3 gap-3">
            <PulseMetric label="Sessões"   value={sessions > 0 ? fmtN(sessions) : "—"} />
            <PulseMetric label="Conversão" value={fmtPct(convRate)} />
            <PulseMetric label="ROAS"      value={avgRoas !== null ? `${avgRoas.toFixed(2)}x` : "—"} />
          </div>

          {/* Mini AreaChart — ROAS trend */}
          <div className="px-2 flex-1">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={72}>
                <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="exec-pulse-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.14} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}    />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={false}
                    axisLine={{ stroke: "#27272a" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: 6,
                      padding: "3px 8px",
                      fontSize: 10,
                    }}
                    itemStyle={{ color: "#a1a1aa", fontSize: 10 }}
                    labelStyle={{ color: "#71717a", fontSize: 9 }}
                    formatter={(v) => [`${Number(v).toFixed(2)}x`, "ROAS"]}
                    labelFormatter={(lbl) => {
                      const parts = String(lbl).split("-");
                      return `${parts[2]}/${parts[1]}`;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="roas"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    fill="url(#exec-pulse-grad)"
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0, fill: "#818cf8" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[72px] flex items-center justify-center text-[9px] text-zinc-700 font-mono">
                sem dados para o período
              </div>
            )}
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
          <div className="px-4 py-2.5 border-b border-zinc-800/40">
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Timeline Operacional</p>
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
          </div>
        </div>
      </div>

    </div>
  );
}
