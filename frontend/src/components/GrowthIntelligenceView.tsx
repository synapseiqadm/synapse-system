"use client";
import { useEffect, useState } from "react";
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Clock, Loader2, ShieldCheck, ShieldAlert,
  Database, Building2, CalendarDays, TrendingUp, Zap, Eye,
} from "lucide-react";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";
import type {
  GrowthOverviewResponse,
  GrowthFunnelResponse,
  GrowthEventsResponse,
  PaidSessionsQualityResponse,
} from "@/types/growth";
import type {
  GovernanceSummaryResponse,
  GovernanceFindingsResponse,
  GovernanceEvidenceResponse,
} from "@/types/governance";

// ─── Local types ──────────────────────────────────────────────────────────────

type Period    = 7 | 15 | 30;
type EnvFilter = "all" | "production" | "local" | "staging" | "preview" | "debug";

interface ApiState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

function initState<T>(): ApiState<T> {
  return { loading: true, data: null, error: null };
}

type GovernanceStatus   = "passed" | "warning" | "failed";
type GovernanceSeverity = "low" | "medium" | "high" | "critical";

// ─── Constants ────────────────────────────────────────────────────────────────

const FUNNEL_STEP_ORDER = ["acquisition", "landing", "engagement", "intent", "conversion"] as const;

const FUNNEL_STEP_LABELS: Record<string, string> = {
  acquisition: "Aquisição",
  landing:     "Landing",
  engagement:  "Engajamento",
  intent:      "Intenção",
  conversion:  "Conversão",
};

const FINDING_NAMES: Record<string, string> = {
  ga4_ads_overlap_insufficient:                    "Sobreposição GA4–Ads Insuficiente",
  ga4_conversion_registry_mismatch:                "Eventos de Conversão Não Registrados",
  ads_conversion_action_not_in_registry:           "Ação de Conversão Fora do Registro",
  ads_conversion_action_semantic_review_required:  "Ação de Conversão em Revisão Semântica",
  ga4_non_production_traffic_detected:             "Tráfego Não-Produção Detectado",
  ga4_suspicious_event_names_detected:             "Nomes de Eventos Suspeitos",
  paid_sessions_without_funnel_progress:           "Sessões Pagas sem Avanço no Funil",
  utm_campaign_empty_in_paid_urls:                 "UTM Campaign Ausente em URLs Pagas",
};

const REVIEW_REQUIRED_CHECKS = new Set(["ads_conversion_action_semantic_review_required"]);

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER:   Record<string, number>  = { failed: 0, warning: 1, passed: 2 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function fmtN(n: number): string {
  return n.toLocaleString("pt-BR");
}

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function buildUrl(base: string, params: Record<string, string | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "all" && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

async function apiGet<T>(url: string): Promise<T> {
  const res  = await fetch(url, { credentials: "same-origin" });
  const json = await res.json() as Record<string, unknown>;
  if (!json.ok) {
    const err  = json.error as { message?: string; code?: string } | undefined;
    if (err?.code === "unauthorized") throw new Error("Sessão expirada ou usuário não autenticado.");
    throw new Error(err?.message ?? `Erro HTTP ${res.status}`);
  }
  return json as T;
}

function settle<T>(result: PromiseSettledResult<T>): ApiState<T> {
  if (result.status === "fulfilled") return { loading: false, data: result.value, error: null };
  const msg = result.reason instanceof Error ? result.reason.message : "Erro desconhecido";
  return { loading: false, data: null, error: msg };
}

function groupByLatest<T>(
  items: T[],
  getKey: (item: T) => string,
  getDate: (item: T) => string,
): Array<{ key: string; latest: T; all: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].map(([key, all]) => {
    const sorted = [...all].sort((a, b) => getDate(b).localeCompare(getDate(a)));
    return { key, latest: sorted[0], all: sorted };
  });
}

// ─── Micro display components ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: GovernanceStatus }) {
  const cfg = {
    passed:  { label: "Passou",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", Icon: CheckCircle2  },
    warning: { label: "Aviso",   cls: "bg-amber-500/15   text-amber-400   border-amber-500/30",   Icon: AlertTriangle },
    failed:  { label: "Falha",   cls: "bg-red-500/15     text-red-400     border-red-500/30",     Icon: XCircle       },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <cfg.Icon size={9} />
      {cfg.label}
    </span>
  );
}

function SeverityBadge({ severity, status }: { severity: GovernanceSeverity; status: GovernanceStatus }) {
  if (status === "passed") {
    return <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-800/60 text-zinc-500 border-zinc-700/40">OK</span>;
  }
  const cfg = {
    critical: { label: "Crítico", cls: "bg-red-500/20    text-red-400    border-red-500/40"    },
    high:     { label: "Alto",    cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    medium:   { label: "Médio",   cls: "bg-amber-500/15  text-amber-400  border-amber-500/30"  },
    low:      { label: "Baixo",   cls: "bg-zinc-700/40   text-zinc-400   border-zinc-600/40"   },
  }[severity];
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

function ReviewRequiredBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-violet-500/15 text-violet-300 border-violet-500/30">
      Em revisão
    </span>
  );
}

function FunnelStepBadge({ step }: { step: string }) {
  const colors: Record<string, string> = {
    acquisition: "bg-sky-500/15     text-sky-400     border-sky-500/30",
    landing:     "bg-indigo-500/15  text-indigo-400  border-indigo-500/30",
    engagement:  "bg-teal-500/15    text-teal-400    border-teal-500/30",
    intent:      "bg-amber-500/15   text-amber-400   border-amber-500/30",
    conversion:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors[step] ?? "bg-zinc-700/40 text-zinc-400 border-zinc-600/40"}`}>
      {FUNNEL_STEP_LABELS[step] ?? step}
    </span>
  );
}

// ─── Section primitives ───────────────────────────────────────────────────────

function SectionLoader() {
  return <div className="flex items-center justify-center h-24"><Loader2 size={20} className="animate-spin text-zinc-600" /></div>;
}

function SectionError({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
      <AlertCircle size={14} className="flex-shrink-0" />
      {msg}
    </div>
  );
}

function SectionEmpty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-24 text-zinc-700 gap-2">
      <Database size={20} className="text-zinc-800" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function SectionCard({ title, subtitle, icon: Icon, children }: {
  title: string; subtitle?: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800/60">
        <div className="w-7 h-7 rounded-lg bg-indigo-600/10 border border-indigo-500/15 flex items-center justify-center flex-shrink-0">
          <Icon size={14} className="text-indigo-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {subtitle && <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string | number; sub?: string;
  icon?: React.ElementType; accent?: boolean;
}) {
  return (
    <div className={`bg-[#0f1117] border rounded-xl p-4 ${accent ? "border-amber-500/30" : "border-zinc-800/60"}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider leading-tight">{label}</p>
        {Icon && (
          <div className="w-6 h-6 rounded-md bg-indigo-600/10 border border-indigo-500/15 flex items-center justify-center flex-shrink-0">
            <Icon size={11} className="text-indigo-400" />
          </div>
        )}
      </div>
      <p className={`text-xl font-bold font-mono ${accent ? "text-amber-400" : "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5 font-mono">{sub}</p>}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function FilterBar({ period, setPeriod, env, setEnv }: {
  period: Period; setPeriod: (p: Period) => void;
  env: EnvFilter; setEnv: (e: EnvFilter) => void;
}) {
  const PERIODS: Period[] = [7, 15, 30];
  const ENV_OPTIONS: { value: EnvFilter; label: string }[] = [
    { value: "all",        label: "Todos"      },
    { value: "production", label: "Production" },
    { value: "staging",    label: "Staging"    },
    { value: "local",      label: "Local"      },
    { value: "preview",    label: "Preview"    },
    { value: "debug",      label: "Debug"      },
  ];

  return (
    <div className="space-y-2 mb-6">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          <CalendarDays size={13} className="text-zinc-600 ml-1.5" />
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                ${period === p ? "bg-indigo-600 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-200"}`}>
              {p}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          {ENV_OPTIONS.map(({ value, label }) => (
            <button key={value} onClick={() => setEnv(value)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                ${env === value ? "bg-zinc-700 text-zinc-200 shadow-sm" : "text-zinc-600 hover:text-zinc-300"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-zinc-700 font-mono">
        Filtro de ambiente aplicado apenas aos blocos com evidência técnica disponível. Os cards principais usam o último snapshot agregado.
      </p>
    </div>
  );
}

// ─── Executive cards ──────────────────────────────────────────────────────────

function ExecutiveCards({ overview, govSummary, paidSessions }: {
  overview: ApiState<GrowthOverviewResponse>;
  govSummary: ApiState<GovernanceSummaryResponse>;
  paidSessions: ApiState<PaidSessionsQualityResponse>;
}) {
  const ga4 = overview.data?.data.ga4_first_light;
  const gov = govSummary.data?.data;

  // Prefer governance findings; fall back to data_quality_shadow when findings table is empty;
  // last resort: use overview quality summary
  const activeWarnings = govSummary.loading ? null
    : gov
      ? (gov.findings.total > 0
          ? gov.findings.warnings + gov.findings.failed
          : gov.data_quality_shadow.warnings + gov.data_quality_shadow.failed)
      : (overview.data?.data.quality
          ? overview.data.data.quality.warnings + overview.data.data.quality.failed
          : null);

  const paidCheck = paidSessions.data?.data.checks.find(
    (c) => c.check_name === "paid_sessions_without_funnel_progress",
  );
  const sessionsWithout = paidCheck?.paid_sessions_without_progress ?? null;

  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
      <StatCard label="Sessões GA4"        value={overview.loading ? "…" : ga4 ? fmtN(ga4.sessions)     : "—"} icon={Activity}   sub="snapshot agregado" />
      <StatCard label="Page Views"         value={overview.loading ? "…" : ga4 ? fmtN(ga4.page_views)   : "—"} icon={TrendingUp}  sub="snapshot agregado" />
      <StatCard label="Eventos Rastreados" value={overview.loading ? "…" : ga4 ? fmtN(ga4.total_events) : "—"} icon={Zap}         sub="snapshot agregado" />
      <StatCard label="Warnings Ativos"       value={govSummary.loading ? "…" : activeWarnings !== null ? fmtN(activeWarnings) : "—"}
                accent={(activeWarnings ?? 0) > 0} icon={ShieldAlert} />
      <StatCard label="Sessões Pagas s/ Avanço" value={paidSessions.loading ? "…" : sessionsWithout !== null ? fmtN(sessionsWithout) : "—"}
                accent={(sessionsWithout ?? 0) > 0} icon={AlertTriangle} />
      <StatCard label="Último Run de Gov."    value={govSummary.loading ? "…" : gov?.latest_run ? fmtTs(gov.latest_run.finished_at ?? gov.latest_run.started_at) : "—"}
                icon={Clock} />
    </div>
  );
}

// ─── GA4 First Light section ──────────────────────────────────────────────────

function Ga4FirstLightSection({ overview, events, env }: {
  overview: ApiState<GrowthOverviewResponse>;
  events: ApiState<GrowthEventsResponse>;
  env: EnvFilter;
}) {
  if (overview.loading) return <SectionLoader />;
  if (overview.error)   return <SectionError msg={overview.error} />;

  const ga4 = overview.data?.data.ga4_first_light;
  if (!ga4)  return <SectionEmpty label="Ainda não há dados GA4 suficientes para esta visão." />;

  const topConv     = Object.entries(ga4.conversion_events ?? {}).filter(([, c]) => c > 0);
  const landingPages = events.data?.data.landing_pages ?? ga4.top_landing_pages ?? [];

  return (
    <div className="space-y-4">
      {env !== "all" && (
        <p className="text-[11px] text-zinc-600 italic">
          Esta visão usa snapshot agregado de GA4. A segmentação por ambiente depende de evidências de governança disponíveis.
        </p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Sessões"         value={fmtN(ga4.sessions)}    />
        <StatCard label="Page Views"      value={fmtN(ga4.page_views)}  />
        <StatCard label="Total Eventos"   value={fmtN(ga4.total_events)} />
        <StatCard label="Usuários Únicos" value={fmtN(ga4.total_users)} />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-600 font-mono">
        {ga4.latest_table      && <span>Tabela: <span className="text-zinc-400">{ga4.latest_table}</span></span>}
        {ga4.date_range_start  && <span>Período: <span className="text-zinc-400">{ga4.date_range_start} → {ga4.date_range_end}</span></span>}
        {ga4.updated_at        && <span>Atualizado: <span className="text-zinc-400">{fmtTs(ga4.updated_at)}</span></span>}
        {ga4.is_mock           && <span className="text-amber-500 font-semibold">Dados de teste (mock)</span>}
      </div>

      {topConv.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Eventos de conversão mapeados</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {topConv.map(([name, count]) => (
              <span key={name} className="inline-flex items-center gap-1.5 text-[11px] bg-zinc-800/60 border border-zinc-700/40 rounded-lg px-2.5 py-1 font-mono">
                <span className="text-zinc-300">{name}</span>
                <span className="text-zinc-600">×{fmtN(count)}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] text-zinc-600 italic">
            Estes eventos estão mapeados no registro semântico. A confirmação como conversão definitiva depende de validação explícita do cliente.
          </p>
        </div>
      )}

      {ga4.top_events.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Top eventos</p>
          <div className="space-y-1">
            {ga4.top_events.slice(0, 8).map((ev) => (
              <div key={ev.event_name} className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-mono">{ev.event_name}</span>
                <span className="text-zinc-500 font-mono tabular-nums">{fmtN(ev.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {landingPages.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2">Top landing pages</p>
          <div className="space-y-1">
            {landingPages.slice(0, 5).map((lp) => (
              <div key={lp.page_location} className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 font-mono truncate max-w-[70%]" title={lp.page_location}>{lp.page_location}</span>
                <span className="text-zinc-600 font-mono tabular-nums">{fmtN(lp.views)} views</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Semantic Funnel section ──────────────────────────────────────────────────

function FunnelSection({ state, env }: { state: ApiState<GrowthFunnelResponse>; env: EnvFilter }) {
  if (state.loading) return <SectionLoader />;
  if (state.error)   return <SectionError msg={state.error} />;

  const data = state.data?.data;
  if (!data || data.events.length === 0) return <SectionEmpty label="Ainda não há dados de funil para este período." />;

  const byStep: Record<string, typeof data.events> = {};
  for (const ev of data.events) {
    (byStep[ev.step] = byStep[ev.step] ?? []).push(ev);
  }

  return (
    <div className="space-y-4">
      {env !== "all" && (
        <p className="text-[11px] text-zinc-600 italic">
          Esta visão usa snapshot agregado de GA4. A segmentação por ambiente depende de evidências de governança disponíveis.
        </p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Sessões"       value={fmtN(data.summary.sessions)}     />
        <StatCard label="Page Views"    value={fmtN(data.summary.page_views)}   />
        <StatCard label="Conversões"    value={fmtN(data.summary.conversions)}  />
        <StatCard label="Total Eventos" value={fmtN(data.summary.total_events)} />
      </div>

      <div className="space-y-2">
        {FUNNEL_STEP_ORDER.filter((s) => byStep[s]?.length).map((step) => (
          <div key={step} className="bg-zinc-900/40 border border-zinc-800/40 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
              <FunnelStepBadge step={step} />
              <span className="text-[11px] text-zinc-600">{byStep[step].length} evento{byStep[step].length > 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-1">
              {byStep[step].map((ev) => (
                <div key={ev.event_name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400 font-mono">{ev.event_name}</span>
                    {ev.is_conversion && (
                      <span className="text-[10px] font-semibold text-emerald-500/70">candidato a conversão</span>
                    )}
                  </div>
                  <span className="text-zinc-500 font-mono tabular-nums">{fmtN(ev.event_count)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {data.summary.conversions > 0 && (
        <p className="text-[11px] text-zinc-600 italic">
          Eventos candidatos a conversão refletem o mapeamento semântico atual. A conversão definitiva depende de validação explícita do cliente.
        </p>
      )}
    </div>
  );
}

// ─── Paid Sessions section ────────────────────────────────────────────────────

function PaidSessionsSection({ state, env }: { state: ApiState<PaidSessionsQualityResponse>; env: EnvFilter }) {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  if (state.loading) return <SectionLoader />;
  if (state.error)   return <SectionError msg={state.error} />;

  const checks = state.data?.data.checks ?? [];
  if (checks.length === 0) return <SectionEmpty label={
    env !== "all"
      ? `Nenhuma evidência segmentada para o ambiente "${env}".`
      : "Ainda não há dados de qualidade de sessões pagas."
  } />;

  const grouped = groupByLatest(checks, (c) => c.check_name, (c) => c.checked_at);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-600">
        Os checks abaixo estão consolidados por tipo de alerta. Quando o mesmo check aparece em múltiplas execuções, exibimos o registro mais recente e indicamos a recorrência.
      </p>
      {grouped.map(({ key, latest: check, all }) => {
        const rawMissing     = check.missing_utm_params;
        const missingParams: string[] = Array.isArray(rawMissing)
          ? rawMissing.filter((x): x is string => typeof x === "string")
          : [];
        const utmCampaignMissing = missingParams.includes("utm_campaign");
        const count          = all.length;
        const isHistoryOpen  = historyKey === key;

        return (
          <div key={key} className={`bg-zinc-900/40 border rounded-xl overflow-hidden ${utmCampaignMissing || check.status !== "passed" ? "border-amber-500/20" : "border-zinc-800/40"}`}>
            <div className="p-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{FINDING_NAMES[check.check_name] ?? check.check_name}</p>
                  <p className="text-[10px] text-zinc-600 font-mono mt-0.5">{check.check_name}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                  {count > 1 && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-800/60 text-zinc-500 border-zinc-700/40">
                      {count} snapshots
                    </span>
                  )}
                  <StatusBadge status={check.status} />
                  <SeverityBadge severity={check.severity} status={check.status} />
                </div>
              </div>

              {/* Metric cards */}
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
                {check.paid_sessions !== null && (
                  <StatCard label="Sessões pagas" value={fmtN(check.paid_sessions)} />
                )}
                {check.paid_sessions_with_progress !== null && (
                  <StatCard label="Com avanço" value={fmtN(check.paid_sessions_with_progress)} />
                )}
                {check.paid_sessions_without_progress !== null && (
                  <StatCard label="Sem avanço" value={fmtN(check.paid_sessions_without_progress)}
                            accent={check.paid_sessions_without_progress > 0} />
                )}
                {check.total_paid_views !== null && (
                  <StatCard label="Views pagos" value={fmtN(check.total_paid_views)} />
                )}
              </div>

              {/* Missing params */}
              {missingParams.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Parâmetros ausentes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {missingParams.map((p) => (
                      <span key={p} className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border
                        ${p === "utm_campaign" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/40"}`}>
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer row */}
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-600 font-mono">
                  Última execução: {check.date_range_start ?? "—"} → {check.date_range_end ?? "—"}
                  {" · "}{fmtTs(check.checked_at)}
                </p>
                {count > 1 && (
                  <button
                    onClick={() => setHistoryKey(isHistoryOpen ? null : key)}
                    className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors ml-3 shrink-0"
                  >
                    {isHistoryOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    Ver histórico ({count - 1} anterior{count > 2 ? "es" : ""})
                  </button>
                )}
              </div>
            </div>

            {/* History accordion */}
            {isHistoryOpen && count > 1 && (
              <div className="border-t border-zinc-800/40 bg-zinc-900/30 divide-y divide-zinc-800/30">
                {all.slice(1).map((item, i) => (
                  <div key={`${item.id}-${i}`} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={item.status} />
                      <p className="text-[10px] text-zinc-600 font-mono">{item.date_range_start} → {item.date_range_end}</p>
                    </div>
                    <p className="text-[10px] text-zinc-700 font-mono">{fmtTs(item.checked_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Governance Summary section ───────────────────────────────────────────────

function GovernanceSummarySection({ state }: { state: ApiState<GovernanceSummaryResponse> }) {
  if (state.loading) return <SectionLoader />;
  if (state.error)   return <SectionError msg={state.error} />;

  const data = state.data?.data;
  if (!data) return <SectionEmpty label="Ainda não há dados de governança para este período." />;

  if (!data.latest_run) {
    const shadow   = data.data_quality_shadow;
    const insights = data.related_insights;
    if (shadow.semantic_checks === 0 && insights.total === 0) {
      return <SectionEmpty label="Ainda não há execução de governança registrada para este período." />;
    }
    const hasIssues = shadow.warnings > 0 || shadow.failed > 0;
    return (
      <div className="space-y-4">
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${hasIssues ? "bg-amber-500/5 border-amber-500/20" : "bg-zinc-800/30 border-zinc-700/40"}`}>
          <Database size={16} className={`mt-0.5 flex-shrink-0 ${hasIssues ? "text-amber-400" : "text-zinc-500"}`} />
          <div>
            <p className={`text-sm font-semibold ${hasIssues ? "text-amber-300" : "text-zinc-400"}`}>
              {hasIssues ? "Pendências semânticas detectadas via data_quality_report." : "Mensuração sem pendências críticas registradas."}
            </p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Governança semântica disponível via data_quality_report. Histórico dedicado de runs/findings/evidence ainda não está visível para esta sessão.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="Checks Semânticos" value={shadow.semantic_checks} />
          <StatCard label="Warnings"          value={shadow.warnings} accent={shadow.warnings > 0} />
          <StatCard label="Falhas"            value={shadow.failed}   accent={shadow.failed > 0}   />
          {insights.total > 0 && <StatCard label="Insights Relacionados" value={insights.total} />}
        </div>
        {insights.high_priority > 0 && (
          <p className="text-[11px] text-amber-500">
            {insights.high_priority} insight{insights.high_priority > 1 ? "s" : ""} de alta prioridade no período.
          </p>
        )}
      </div>
    );
  }

  const { runs, findings, evidence, latest_run, related_insights } = data;
  const hasIssues = findings.warnings > 0 || findings.failed > 0;

  const statusMsg = !hasIssues
    ? "Mensuração semanticamente saudável no período analisado."
    : findings.failed > 0
      ? "Existem falhas que reduzem a confiabilidade executiva dos dados."
      : "Existem pendências semânticas que reduzem a confiabilidade executiva dos dados.";

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl px-4 py-3 border ${hasIssues ? "bg-amber-500/5 border-amber-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
        {hasIssues
          ? <ShieldAlert   size={16} className="text-amber-400  mt-0.5 flex-shrink-0" />
          : <ShieldCheck   size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />}
        <div>
          <p className={`text-sm font-semibold ${hasIssues ? "text-amber-300" : "text-emerald-300"}`}>{statusMsg}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
            Último run: {fmtTs(latest_run.finished_at ?? latest_run.started_at)}
            {" · "}{latest_run.checks_run} checks · {latest_run.findings_count} findings
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label="Runs"       value={runs.total}        sub={`${runs.success} ok · ${runs.error} erro`} />
        <StatCard label="Passed"     value={findings.passed}   />
        <StatCard label="Warnings"   value={findings.warnings} accent={findings.warnings > 0} />
        <StatCard label="Evidências" value={evidence.total}    />
      </div>

      {findings.critical > 0 && (
        <p className="text-[11px] text-red-400 font-semibold">
          {findings.critical} finding{findings.critical > 1 ? "s" : ""} crítico{findings.critical > 1 ? "s" : ""} — requer atenção imediata.
        </p>
      )}

      {related_insights.total > 0 && (
        <p className="text-[11px] text-zinc-600">
          {related_insights.total} insight{related_insights.total > 1 ? "s" : ""} relacionado{related_insights.total > 1 ? "s" : ""}
          {related_insights.high_priority > 0 && ` · ${related_insights.high_priority} alta prioridade`}.
        </p>
      )}
    </div>
  );
}

// ─── Findings section ─────────────────────────────────────────────────────────

function FindingsSection({ state, govSummary, env }: {
  state: ApiState<GovernanceFindingsResponse>;
  govSummary: ApiState<GovernanceSummaryResponse>;
  env: EnvFilter;
}) {
  const [openKey,    setOpenKey]    = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  if (state.loading) return <SectionLoader />;
  if (state.error)   return <SectionError msg={state.error} />;

  const findings = state.data?.data.findings ?? [];

  if (findings.length === 0) {
    const shadow  = govSummary.data?.data.data_quality_shadow;
    const insights = govSummary.data?.data.related_insights;
    const hasShadow = (shadow?.semantic_checks ?? 0) > 0;

    if (!hasShadow) {
      return <SectionEmpty label={
        env !== "all"
          ? `Nenhuma evidência segmentada para o ambiente "${env}".`
          : "Nenhum finding encontrado com os filtros atuais."
      } />;
    }

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl px-4 py-3 border bg-amber-500/5 border-amber-500/20">
          <Database size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-300">Findings dedicados ainda não visíveis</p>
            <p className="text-[11px] text-zinc-500 mt-1">
              A governança semântica foi detectada via data_quality_report, mas o histórico dedicado de semantic_governance_findings ainda não está disponível para leitura no frontend.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard label="Checks Semânticos" value={shadow!.semantic_checks} />
          <StatCard label="Warnings"          value={shadow!.warnings} accent={shadow!.warnings > 0} />
          <StatCard label="Falhas"            value={shadow!.failed}   accent={shadow!.failed > 0} />
          {(insights?.total ?? 0) > 0 && <StatCard label="Insights Relacionados" value={insights!.total} />}
        </div>
        <p className="text-[11px] text-zinc-600 italic">
          A exposição controlada dos findings dedicados deve ser resolvida em uma task futura de RLS/auth.
        </p>
        {env !== "all" && (
          <p className="text-[11px] text-zinc-600 italic">
            A segmentação por ambiente depende de evidências dedicadas disponíveis.
          </p>
        )}
      </div>
    );
  }

  const grouped = groupByLatest(findings, (f) => f.check_name, (f) => f.created_at);

  const sortedGroups = [...grouped].sort((a, b) => {
    const s = STATUS_ORDER[a.latest.status] - STATUS_ORDER[b.latest.status];
    if (s !== 0) return s;
    return SEVERITY_ORDER[a.latest.severity] - SEVERITY_ORDER[b.latest.severity];
  });

  return (
    <div>
      <p className="text-[11px] text-zinc-600 px-3 py-2 border-b border-zinc-800/40">
        Os checks abaixo estão consolidados por tipo de alerta. Quando o mesmo check aparece em múltiplas execuções, exibimos o registro mais recente e indicamos a recorrência.
      </p>

      <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-3 py-2 border-b border-zinc-800/60 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
        <span>Check</span>
        <span>Status</span>
        <span>Severidade</span>
        <span className="text-right">Linhas</span>
        <span>Fonte</span>
        <span className="w-4" />
      </div>

      <div className="divide-y divide-zinc-800/40">
        {sortedGroups.map(({ key, latest: f, all }) => {
          const isDetailOpen = openKey    === key;
          const isHistOpen   = historyKey === key;
          const hasDetails   = f.details != null;
          const isReviewReqd = REVIEW_REQUIRED_CHECKS.has(f.check_name);
          const displayName  = FINDING_NAMES[f.check_name] ?? f.check_name;
          const count        = all.length;

          return (
            <div key={key}>
              {/* Main row */}
              <button
                onClick={() => hasDetails && setOpenKey(isDetailOpen ? null : key)}
                className={`w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-3 px-3 py-3 text-left transition-colors
                  ${hasDetails ? "hover:bg-white/[0.02] cursor-pointer" : "cursor-default"}
                  ${isDetailOpen ? "bg-white/[0.025]" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm text-zinc-200 font-medium">{displayName}</p>
                    {isReviewReqd && <ReviewRequiredBadge />}
                    {count > 1 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-800/60 text-zinc-500 border-zinc-700/40">
                        {count} runs
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-600 font-mono mt-0.5 truncate">{f.check_name}</p>
                </div>
                <StatusBadge   status={f.status}   />
                <SeverityBadge severity={f.severity} status={f.status} />
                <span className={`text-xs font-mono text-right tabular-nums ${f.affected_rows > 0 ? "text-zinc-300" : "text-zinc-700"}`}>
                  {fmtN(f.affected_rows)}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono">{f.source_platform}</span>
                <span className="w-4 flex justify-end">
                  {hasDetails && (isDetailOpen
                    ? <ChevronUp size={12} className="text-zinc-500" />
                    : <ChevronDown size={12} className="text-zinc-600" />)}
                </span>
              </button>

              {/* Details accordion */}
              {isDetailOpen && f.details && (
                <div className="px-3 pb-3 bg-white/[0.015] border-t border-zinc-800/40">
                  <div className="mt-3 space-y-1.5">
                    {Object.entries(f.details).map(([k, v]) => (
                      <div key={k} className="flex gap-3 text-xs">
                        <span className="text-zinc-600 shrink-0 w-44 font-mono">{k}</span>
                        <span className="text-zinc-300 font-mono break-all">
                          {typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-zinc-600 font-mono">
                    Última execução: {f.date_range_start} → {f.date_range_end} · {fmtTs(f.created_at)}
                  </p>
                </div>
              )}

              {/* History accordion trigger */}
              {count > 1 && (
                <div className="px-3 pb-2.5">
                  <button
                    onClick={() => setHistoryKey(isHistOpen ? null : key)}
                    className="flex items-center gap-1 text-[11px] text-zinc-700 hover:text-zinc-400 transition-colors"
                  >
                    {isHistOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    Ver histórico deste check ({count - 1} anterior{count > 2 ? "es" : ""})
                  </button>

                  {isHistOpen && (
                    <div className="mt-2 border border-zinc-800/40 rounded-xl overflow-hidden divide-y divide-zinc-800/30">
                      {all.slice(1).map((item, i) => (
                        <div key={`${item.id}-${i}`} className="px-4 py-2.5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <StatusBadge status={item.status} />
                            <p className="text-[10px] text-zinc-600 font-mono">{item.date_range_start} → {item.date_range_end}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-mono ${item.affected_rows > 0 ? "text-zinc-400" : "text-zinc-700"}`}>
                              {fmtN(item.affected_rows)} linhas
                            </span>
                            <p className="text-[10px] text-zinc-700 font-mono">{fmtTs(item.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Evidence accordion ───────────────────────────────────────────────────────

function EvidenceSection({ state, env }: { state: ApiState<GovernanceEvidenceResponse>; env: EnvFilter }) {
  const [open, setOpen] = useState(false);
  const evidence = state.data?.data.evidence ?? [];

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <Eye size={14} />
        <span>Ver evidências técnicas</span>
        {state.loading
          ? <Loader2 size={12} className="animate-spin ml-1 text-zinc-600" />
          : <span className="text-[10px] text-zinc-700 ml-1">({state.error ? "erro" : evidence.length})</span>}
      </button>

      {open && (
        <div className="mt-3 border border-zinc-800/60 rounded-xl overflow-hidden">
          {state.loading ? (
            <SectionLoader />
          ) : state.error ? (
            <div className="p-4"><SectionError msg={state.error} /></div>
          ) : evidence.length === 0 ? (
            <SectionEmpty label={
              env !== "all"
                ? `Nenhuma evidência segmentada para o ambiente "${env}".`
                : "Nenhuma evidência encontrada."
            } />
          ) : (
            <div className="divide-y divide-zinc-800/40 max-h-[480px] overflow-y-auto">
              {evidence.slice(0, 50).map((ev) => (
                <div key={ev.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-zinc-400 font-mono">{ev.evidence_type}</span>
                    <span className="text-[10px] text-zinc-600 font-mono">{ev.finding.check_name}</span>
                  </div>
                  <pre className="text-[10px] text-zinc-500 font-mono bg-zinc-900/60 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(ev.evidence_data, null, 2).slice(0, 500)}
                    {JSON.stringify(ev.evidence_data).length > 500 ? "\n…" : ""}
                  </pre>
                </div>
              ))}
              {evidence.length > 50 && (
                <p className="px-4 py-2 text-[10px] text-zinc-700 font-mono">
                  Mostrando 50 de {evidence.length} evidências.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GrowthIntelligenceView() {
  const [period, setPeriod] = useState<Period>(30);
  const [env,    setEnv]    = useState<EnvFilter>("all");

  const [overview,     setOverview]     = useState<ApiState<GrowthOverviewResponse>>(initState());
  const [funnel,       setFunnel]       = useState<ApiState<GrowthFunnelResponse>>(initState());
  const [events,       setEvents]       = useState<ApiState<GrowthEventsResponse>>(initState());
  const [paidSessions, setPaidSessions] = useState<ApiState<PaidSessionsQualityResponse>>(initState());
  const [govSummary,   setGovSummary]   = useState<ApiState<GovernanceSummaryResponse>>(initState());
  const [findings,     setFindings]     = useState<ApiState<GovernanceFindingsResponse>>(initState());
  const [evidence,     setEvidence]     = useState<ApiState<GovernanceEvidenceResponse>>(initState());

  useEffect(() => {
    let cancelled = false;

    const wid    = DEFAULT_WORKSPACE.id;
    const base   = `/api/workspaces/${wid}`;
    const params: Record<string, string | undefined> = {
      date_start:  sinceDate(period),
      environment: env === "all" ? undefined : env,
      limit:       "100",
    };

    Promise.allSettled([
      apiGet<GrowthOverviewResponse>    (buildUrl(`${base}/growth/overview`,      params)),
      apiGet<GrowthFunnelResponse>      (buildUrl(`${base}/growth/funnel`,        params)),
      apiGet<GrowthEventsResponse>      (buildUrl(`${base}/growth/events`,        params)),
      apiGet<PaidSessionsQualityResponse>(buildUrl(`${base}/growth/paid-sessions`, params)),
      apiGet<GovernanceSummaryResponse> (buildUrl(`${base}/governance/summary`,   params)),
      apiGet<GovernanceFindingsResponse>(buildUrl(`${base}/governance/findings`,  params)),
      apiGet<GovernanceEvidenceResponse>(buildUrl(`${base}/governance/evidence`,  params)),
    ]).then(([r0, r1, r2, r3, r4, r5, r6]) => {
      if (cancelled) return;
      setOverview(settle(r0));
      setFunnel(settle(r1));
      setEvents(settle(r2));
      setPaidSessions(settle(r3));
      setGovSummary(settle(r4));
      setFindings(settle(r5));
      setEvidence(settle(r6));
    });

    return () => { cancelled = true; };
  }, [period, env]);

  // Collect envelope-level warnings from successful responses
  const envelopeWarnings = [overview, funnel, events, paidSessions, govSummary, findings, evidence]
    .flatMap((s) => (s.data as { warnings?: string[] } | null)?.warnings ?? [])
    .filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Workspace label */}
      <div className="flex items-center gap-1.5">
        <Building2 size={11} className="text-zinc-600" />
        <span className="text-[11px] text-zinc-500 font-mono">
          Workspace: <span className="text-zinc-400">{DEFAULT_WORKSPACE.name}</span>
        </span>
      </div>

      <FilterBar period={period} setPeriod={setPeriod} env={env} setEnv={setEnv} />

      {/* Available data window microcopy */}
      {!overview.loading && overview.data?.data.ga4_first_light && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-600 font-mono -mt-3 mb-1">
          <CalendarDays size={11} className="text-zinc-700 flex-shrink-0" />
          <span>
            Janela disponível:{" "}
            <span className="text-zinc-500">{overview.data.data.ga4_first_light.date_range_start}</span>
            {" → "}
            <span className="text-zinc-500">{overview.data.data.ga4_first_light.date_range_end}</span>
          </span>
        </div>
      )}

      <ExecutiveCards overview={overview} govSummary={govSummary} paidSessions={paidSessions} />

      {/* Envelope warnings (table missing, etc.) */}
      {envelopeWarnings.map((w, i) => (
        <div key={i} className="flex items-center gap-2.5 bg-zinc-800/40 border border-zinc-700/40 rounded-xl px-4 py-2 text-[11px] text-zinc-500 font-mono">
          <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
          {w}
        </div>
      ))}

      <SectionCard title="GA4 First Light" subtitle="ga4_first_light_summary · growth/overview + growth/events" icon={Database}>
        <Ga4FirstLightSection overview={overview} events={events} env={env} />
      </SectionCard>

      <SectionCard title="Funil Semântico" subtitle="ga4_first_light_summary · growth/funnel" icon={TrendingUp}>
        <FunnelSection state={funnel} env={env} />
      </SectionCard>

      <SectionCard title="Qualidade de Sessões Pagas" subtitle="data_quality_report · growth/paid-sessions" icon={ShieldCheck}>
        <PaidSessionsSection state={paidSessions} env={env} />
      </SectionCard>

      <SectionCard title="Governance Summary" subtitle="semantic_governance_runs · governance/summary" icon={ShieldCheck}>
        <GovernanceSummarySection state={govSummary} />
      </SectionCard>

      <SectionCard title="Findings Semânticos" subtitle="semantic_governance_findings · governance/findings" icon={ShieldAlert}>
        <FindingsSection state={findings} govSummary={govSummary} env={env} />
      </SectionCard>

      <SectionCard title="Evidências Técnicas" subtitle="semantic_governance_evidence · governance/evidence" icon={Activity}>
        <EvidenceSection state={evidence} env={env} />
      </SectionCard>

      <p className="text-[11px] text-zinc-700 italic pb-4">
        A SynapseIQ não decide pela Woke People qual evento é a conversão definitiva. Eventos em revisão semântica permanecem como candidatos até validação explícita do cliente.
      </p>
    </div>
  );
}
