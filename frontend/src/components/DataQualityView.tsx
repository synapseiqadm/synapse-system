"use client";
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  Loader2, AlertCircle, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Clock, ShieldCheck, ShieldAlert,
  Database,
} from "lucide-react";

const WOKE_WORKSPACE_ID = "a082fe86-a65f-4c9b-9442-fe775f47e3fc";

// ─── Types ────────────────────────────────────────────────────────────────────

type DataQualityStatus   = "passed" | "warning" | "failed";
type DataQualitySeverity = "low" | "medium" | "high" | "critical";

interface DataQualityReport {
  id: string;
  workspace_id: string;
  check_name: string;
  check_category: string;
  status: DataQualityStatus;
  severity: DataQualitySeverity;
  source_platform?: string | null;
  target_table?: string | null;
  metric_value?: number | null;
  threshold_value?: number | null;
  affected_rows: number;
  details?: Record<string, unknown> | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  checked_at: string;
  created_at?: string;
}

// ─── Score logic ──────────────────────────────────────────────────────────────

const PENALTIES: Record<DataQualityStatus, Partial<Record<DataQualitySeverity, number>>> = {
  passed:  {},
  warning: { low: 5, medium: 10, high: 15, critical: 20 },
  failed:  { low: 20, medium: 30, high: 40, critical: 60 },
};

function calculateDataHealthScore(checks: DataQualityReport[]): number {
  const penalty = checks.reduce((sum, c) => sum + (PENALTIES[c.status]?.[c.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function scoreLabel(score: number): { label: string; color: string; ring: string; text: string } {
  if (score >= 90) return { label: "Saudável", color: "text-emerald-400", ring: "border-emerald-500/50", text: "text-emerald-300" };
  if (score >= 70) return { label: "Atenção",  color: "text-amber-400",   ring: "border-amber-500/50",   text: "text-amber-300"   };
  if (score >= 40) return { label: "Risco",    color: "text-orange-400",  ring: "border-orange-500/50",  text: "text-orange-300"  };
  return              { label: "Crítico",  color: "text-red-400",     ring: "border-red-500/50",     text: "text-red-300"     };
}

function getHealthExplanation(checks: DataQualityReport[]): string {
  const hasFailedCriticalOrHigh = checks.some(
    (c) => c.status === "failed" && (c.severity === "critical" || c.severity === "high"),
  );
  if (hasFailedCriticalOrHigh) return "Há falhas críticas que precisam ser corrigidas antes da análise.";

  const hasFailed = checks.some((c) => c.status === "failed");
  if (hasFailed) return "Há falhas de qualidade que podem comprometer a análise.";

  const hasZeroConversionsWarning = checks.some(
    (c) => c.status === "warning" && c.check_name.includes("zero_conversions"),
  );
  if (hasZeroConversionsWarning) return "Existem campanhas ou keywords com custo sem conversão.";

  const hasMockWarning = checks.some(
    (c) => c.status === "warning" && c.check_name === "mock_data_presence",
  );
  if (hasMockWarning) return "Há dados de teste presentes no ambiente.";

  if (checks.length > 0 && checks.every((c) => c.status === "passed"))
    return "Os dados estão atualizados e prontos para análise.";

  return "Revise os checks abaixo para entender a saúde dos dados.";
}

// ─── Grouping / sorting ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<DataQualitySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER:   Record<DataQualityStatus, number>   = { failed: 0, warning: 1, passed: 2 };

function getLatestChecksByName(checks: DataQualityReport[]): DataQualityReport[] {
  const map = new Map<string, DataQualityReport>();
  for (const c of checks) {
    const existing = map.get(c.check_name);
    if (!existing || c.checked_at > existing.checked_at) map.set(c.check_name, c);
  }
  return [...map.values()].sort((a, b) => {
    const sv = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sv !== 0) return sv;
    return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  });
}

// ─── Display maps ─────────────────────────────────────────────────────────────

const CHECK_NAMES: Record<string, string> = {
  campaign_summary_missing_campaign_id:          "IDs de Campanha Ausentes",
  campaign_summary_zero_conversions_with_cost:   "Campanhas Sem Conversão (com Custo)",
  keyword_analysis_zero_conversions_with_cost:   "Keywords Sem Conversão (com Custo)",
  campaign_summary_freshness:                    "Frescor dos Dados · Campanhas",
  keyword_analysis_freshness:                    "Frescor dos Dados · Keywords",
  mock_data_presence:                            "Dados de Teste (Mock)",
};

const CATEGORY_NAMES: Record<string, string> = {
  completeness: "Completude",
  consistency:  "Consistência",
  freshness:    "Frescor",
  integrity:    "Integridade",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: DataQualityStatus }) {
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

// When status=passed, shows a neutral "OK" badge instead of the actual severity label
// (severity represents impact if it *were* to fail — misleading to show "Alto" next to "Passou")
function SeverityBadge({ severity, status }: { severity: DataQualitySeverity; status: DataQualityStatus }) {
  if (status === "passed") {
    return (
      <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-800/60 text-zinc-500 border-zinc-700/40">
        OK
      </span>
    );
  }
  const cfg = {
    critical: { label: "Crítico", cls: "bg-red-500/20    text-red-400    border-red-500/40"    },
    high:     { label: "Alto",    cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    medium:   { label: "Médio",   cls: "bg-amber-500/15  text-amber-400  border-amber-500/30"  },
    low:      { label: "Baixo",   cls: "bg-zinc-700/40   text-zinc-400   border-zinc-600/40"   },
  }[severity];
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// Formats example table cell values; detects cost columns and applies BRL currency
function formatExampleValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  const isMonetary = key === "cost" || key.endsWith("_cost") || key.startsWith("cost_");
  if (isMonetary && typeof val === "number") {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (typeof val === "number") {
    return Number.isInteger(val) ? val.toLocaleString("pt-BR") : val.toFixed(2);
  }
  return String(val);
}

function CheckDetails({ details }: { details: Record<string, unknown> | null | undefined }) {
  if (!details) return null;

  const { examples, ...rest } = details as { examples?: Record<string, unknown>[]; [k: string]: unknown };

  return (
    <div className="space-y-3 pt-1">
      {/* Key-value metadata */}
      {Object.keys(rest).length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
          {Object.entries(rest).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-zinc-600 shrink-0">{k.replace(/_/g, " ")}:</dt>
              <dd className="text-zinc-300 font-mono break-all">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Examples table */}
      {examples && examples.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">
            Exemplos ({examples.length})
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60 bg-zinc-900/60">
                  {Object.keys(examples[0]).map((col) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-left text-[10px] text-zinc-500 uppercase tracking-wider font-semibold whitespace-nowrap"
                    >
                      {col.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {examples.map((row, i) => (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    {Object.entries(row).map(([key, val], j) => (
                      <td key={j} className="px-3 py-2 text-zinc-300 font-mono whitespace-nowrap">
                        {val === null
                          ? <span className="text-zinc-700">null</span>
                          : formatExampleValue(key, val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sort / filter types ──────────────────────────────────────────────────────

type FilterOption = "all" | "passed" | "warning" | "failed" | "critical";
type SortOption   = "severity" | "date" | "rows";

// ─── Main view ────────────────────────────────────────────────────────────────

export function DataQualityView() {
  const supabase = createClient();

  const [checks, setChecks]         = useState<DataQualityReport[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter]         = useState<FilterOption>("all");
  const [sort, setSort]             = useState<SortOption>("severity");

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      const { data, error: sbError } = await supabase
        .from("data_quality_report")
        .select("*")
        .eq("workspace_id", WOKE_WORKSPACE_ID)
        .order("checked_at", { ascending: false })
        .limit(200);
      if (sbError) { setError(sbError.message); setLoading(false); return; }
      setChecks((data as DataQualityReport[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const latest = useMemo(() => getLatestChecksByName(checks), [checks]);

  const score       = useMemo(() => calculateDataHealthScore(latest), [latest]);
  const scoreMeta   = useMemo(() => scoreLabel(score), [score]);
  const explanation = useMemo(() => getHealthExplanation(latest), [latest]);

  const passed   = latest.filter((c) => c.status === "passed").length;
  const warnings = latest.filter((c) => c.status === "warning").length;
  const failed   = latest.filter((c) => c.status === "failed").length;
  const critical = latest.filter((c) => c.severity === "critical" && c.status !== "passed").length;

  const lastCheckedAt = checks.length > 0 ? checks[0].checked_at : null;

  const filtered = useMemo(() => {
    let list = latest;
    if (filter === "passed")        list = list.filter((c) => c.status === "passed");
    else if (filter === "warning")  list = list.filter((c) => c.status === "warning");
    else if (filter === "failed")   list = list.filter((c) => c.status === "failed");
    else if (filter === "critical") list = list.filter((c) => c.severity === "critical");

    if (sort === "date") {
      list = [...list].sort((a, b) => b.checked_at.localeCompare(a.checked_at));
    } else if (sort === "rows") {
      list = [...list].sort((a, b) => b.affected_rows - a.affected_rows);
    }
    return list;
  }, [latest, filter, sort]);

  const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
    { value: "all",      label: "Todos"   },
    { value: "passed",   label: "Passou"  },
    { value: "warning",  label: "Aviso"   },
    { value: "failed",   label: "Falha"   },
    { value: "critical", label: "Crítico" },
  ];

  const SORT_OPTIONS: { value: SortOption; label: string }[] = [
    { value: "severity", label: "Severidade" },
    { value: "date",     label: "Data"       },
    { value: "rows",     label: "Linhas"     },
  ];

  function formatCheckedAt(iso: string): string {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 max-w-lg w-full">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>Erro ao carregar checks: <span className="font-mono text-xs">{error}</span></span>
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (latest.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-zinc-700">
        <Database size={28} className="text-zinc-800" />
        <p className="text-sm">
          Nenhum resultado encontrado em{" "}
          <span className="font-mono">data_quality_report</span>.
        </p>
        <p className="text-xs text-zinc-800">Execute o pipeline para gerar dados:</p>
        <pre className="text-[11px] bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-500 font-mono">
          python -m connectors.a_data_sync
        </pre>
      </div>
    );
  }

  return (
    <>
      {/* ── Summary cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">

        {/* Score card */}
        <div className={`bg-[#0f1117] border rounded-xl p-5 ${scoreMeta.ring}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Saúde dos Dados
            </p>
            <div className="w-7 h-7 rounded-lg bg-indigo-600/10 border border-indigo-500/15 flex items-center justify-center">
              <ShieldCheck size={13} className="text-indigo-400" />
            </div>
          </div>
          <p className={`text-3xl font-bold mb-0.5 ${scoreMeta.color}`}>{score}</p>
          <p className={`text-[11px] font-semibold ${scoreMeta.text}`}>{scoreMeta.label}</p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-snug">{explanation}</p>
        </div>

        {/* Passed */}
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Passou</p>
            <CheckCircle2 size={14} className="text-emerald-500/60" />
          </div>
          <p className="text-3xl font-bold text-white">{passed}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">{latest.length} checks no total</p>
        </div>

        {/* Warnings + failures — clearer two-line layout */}
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Avisos / Falhas
            </p>
            <ShieldAlert size={14} className="text-amber-500/60" />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline gap-1.5">
              <p className="text-2xl font-bold text-amber-400 tabular-nums">{warnings}</p>
              <p className="text-xs text-amber-600 font-medium">
                aviso{warnings !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-baseline gap-1.5">
              <p className="text-2xl font-bold text-red-400 tabular-nums">{failed}</p>
              <p className="text-xs text-red-600 font-medium">
                falha{failed !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          {critical > 0 && (
            <p className="text-[11px] text-red-500 mt-1.5 font-semibold">
              {critical} crítico{critical > 1 ? "s" : ""}
            </p>
          )}
        </div>

        {/* Last update */}
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
              Última Verificação
            </p>
            <Clock size={14} className="text-zinc-600" />
          </div>
          {lastCheckedAt ? (
            <>
              <p className="text-sm font-semibold text-white leading-snug">
                {formatCheckedAt(lastCheckedAt)}
              </p>
              <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
                {checks.length} registros históricos
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-700">—</p>
          )}
        </div>
      </div>

      {/* ── Checks table ─────────────────────────────────────────────────────── */}
      <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800/60 flex-wrap">
          {/* Status filter */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 flex-wrap">
            {FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                  ${filter === value
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-200"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Sort */}
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-600">
            <span>Ordenar:</span>
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
              {SORT_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setSort(value)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${sort === value
                      ? "bg-zinc-700 text-zinc-200 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Microcopy — only when there are warnings to demystify them */}
        {warnings > 0 && (
          <p className="text-[11px] text-zinc-600 italic px-4 py-2 border-b border-zinc-800/40 bg-zinc-900/20">
            Warnings indicam pontos de atenção nos dados, não falha técnica do pipeline.
          </p>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-zinc-700 text-sm">
            Nenhum check encontrado para esse filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-900/30 min-w-[560px]">
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Check</span>
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Categoria</span>
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Status</span>
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Severidade</span>
              <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-right">Linhas</span>
              <span className="w-5" />
            </div>

            <div className="divide-y divide-zinc-800/40">
              {filtered.map((c) => {
                const isOpen     = expandedId === c.id;
                const name       = CHECK_NAMES[c.check_name] ?? c.check_name;
                const cat        = CATEGORY_NAMES[c.check_category] ?? c.check_category;
                const hasDetails = c.details != null;

                return (
                  <div key={c.id}>
                    <button
                      onClick={() => hasDetails && setExpandedId(isOpen ? null : c.id)}
                      className={`w-full grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-4 px-4 py-3 text-left transition-colors min-w-[560px]
                        ${hasDetails ? "hover:bg-white/[0.02] cursor-pointer" : "cursor-default"}
                        ${isOpen ? "bg-white/[0.025]" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 font-medium truncate">{name}</p>
                        <p className="text-[10px] text-zinc-600 font-mono mt-0.5 truncate">
                          {c.check_name}
                        </p>
                      </div>
                      <span className="text-[11px] text-zinc-500 whitespace-nowrap">{cat}</span>
                      <StatusBadge status={c.status} />
                      <SeverityBadge severity={c.severity} status={c.status} />
                      <span className={`text-xs font-mono text-right tabular-nums
                        ${c.affected_rows > 0 ? "text-zinc-300" : "text-zinc-700"}`}>
                        {c.affected_rows.toLocaleString("pt-BR")}
                      </span>
                      <span className="w-5 flex justify-end">
                        {hasDetails
                          ? isOpen
                            ? <ChevronUp size={13} className="text-zinc-500" />
                            : <ChevronDown size={13} className="text-zinc-600" />
                          : null}
                      </span>
                    </button>

                    {/* Accordion */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-white/[0.015] border-t border-zinc-800/40">
                        <CheckDetails details={c.details} />
                        {(c.metric_value != null || c.threshold_value != null || c.date_range_start) && (
                          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 pt-3 border-t border-zinc-800/40 text-[11px] text-zinc-600">
                            {c.metric_value    != null && <span>Métrica: <span className="text-zinc-400 font-mono">{c.metric_value}</span></span>}
                            {c.threshold_value != null && <span>Limite: <span className="text-zinc-400 font-mono">{c.threshold_value}</span></span>}
                            {c.date_range_start && (
                              <span>
                                Período:{" "}
                                <span className="text-zinc-400 font-mono">
                                  {c.date_range_start} → {c.date_range_end}
                                </span>
                              </span>
                            )}
                            <span>
                              Verificado:{" "}
                              <span className="text-zinc-400 font-mono">{formatCheckedAt(c.checked_at)}</span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="border-t border-zinc-800/40 px-4 py-2.5">
            <p className="text-[10px] text-zinc-700 font-mono">
              {filtered.length} de {latest.length} checks · {checks.length} execuções históricas
            </p>
          </div>
        )}
      </div>
    </>
  );
}
