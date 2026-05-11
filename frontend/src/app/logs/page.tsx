"use client";
import { useState, useMemo, useEffect } from "react";
import { DashNav } from "../../components/DashNav";
import { SyncRunsTable } from "../../components/SyncRunsTable";
import { LogStatusBadge } from "../../components/LogStatusBadge";
import {
  Terminal,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Database,
  RefreshCcw,
  Wifi,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";
import {
  type SyncRun,
  type HealthStatus,
  EXPECTED_SOURCES,
  mapBadgeStatus,
  latestPerExpectedSource,
  computeHealth,
  timeAgo,
  formatDateShort,
} from "@/lib/api/sync_runs";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "success" | "error" | "running";
type SourceFilter = "all" | string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HEALTH_META: Record<
  HealthStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  healthy: {
    label: "Saudável",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  warning: {
    label: "Atenção",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  error: {
    label: "Crítico",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  unknown: {
    label: "Sem dados",
    color: "text-zinc-500",
    bg: "bg-zinc-800/30",
    border: "border-zinc-700/30",
  },
};

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "success", label: "Sucesso" },
  { id: "error", label: "Falha" },
  { id: "running", label: "Em execução" },
];

// ─── Summary computation ──────────────────────────────────────────────────────

function computeSummary(runs: SyncRun[]) {
  const latestMap = latestPerExpectedSource(runs);
  const health = computeHealth(latestMap);

  const latestRun = runs[0] ?? null;

  const sourcesOk = EXPECTED_SOURCES.filter(
    (s) => latestMap[s]?.status === "success",
  ).length;

  const rowsLoaded = EXPECTED_SOURCES.reduce((acc, s) => {
    return acc + (latestMap[s]?.rows_loaded ?? 0);
  }, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentErrors = runs.filter(
    (r) =>
      r.status === "error" && new Date(r.started_at) >= sevenDaysAgo,
  ).length;

  const latestFinished = EXPECTED_SOURCES.map((s) => latestMap[s]?.finished_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    health,
    latestRun,
    sourcesOk,
    rowsLoaded,
    recentErrors,
    latestFinished,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setFetchError(null);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sync_runs")
        .select("*")
        .eq("workspace_id", DEFAULT_WORKSPACE.id)
        .order("started_at", { ascending: false })
        .limit(50);

      if (error) {
        setFetchError(error.message);
      } else {
        setRuns((data as SyncRun[]) ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  const sources = useMemo(() => {
    const unique = Array.from(new Set(runs.map((r) => r.data_source)));
    return ["all", ...unique];
  }, [runs]);

  const filtered = useMemo(() => {
    return runs.filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (sourceFilter !== "all" && run.data_source !== sourceFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          run.data_source.toLowerCase().includes(q) ||
          run.source_platform.toLowerCase().includes(q) ||
          run.status.toLowerCase().includes(q) ||
          (run.error_message?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [runs, search, statusFilter, sourceFilter]);

  const summary = useMemo(() => computeSummary(runs), [runs]);
  const healthMeta = HEALTH_META[summary.health];

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <DashNav />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-5 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <Terminal size={14} className="text-zinc-300" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Observabilidade · Sync</h1>
              <p className="text-[10px] text-zinc-500 font-mono">
                sync_runs · {loading ? "carregando…" : `${runs.length} registros`}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              setLoading(true);
              setFetchError(null);
              const supabase = createClient();
              supabase
                .from("sync_runs")
                .select("*")
                .eq("workspace_id", DEFAULT_WORKSPACE.id)
                .order("started_at", { ascending: false })
                .limit(50)
                .then(({ data, error }) => {
                  if (error) setFetchError(error.message);
                  else setRuns((data as SyncRun[]) ?? []);
                  setLoading(false);
                });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-slate-200 bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-600 rounded-lg transition-colors"
          >
            <RefreshCcw size={12} />
            Atualizar
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {/* Fetch error banner */}
          {fetchError && (
            <div className="mb-4 flex items-center gap-2 bg-red-950/40 border border-red-800/40 rounded-xl px-4 py-3">
              <XCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-300 font-mono">{fetchError}</p>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            {/* Status geral */}
            <div
              className={`flex items-center gap-3 bg-[#0d1117] border ${healthMeta.border} rounded-xl p-3`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${healthMeta.bg}`}>
                <Wifi size={15} className={healthMeta.color} />
              </div>
              <div>
                <p className={`text-base font-bold leading-none font-mono ${healthMeta.color}`}>
                  {healthMeta.label}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Status geral</p>
              </div>
            </div>

            {/* Última execução */}
            <div className="flex items-center gap-3 bg-[#0d1117] border border-zinc-800/60 rounded-xl p-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10">
                <Clock size={15} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100 leading-none font-mono">
                  {loading
                    ? "—"
                    : summary.latestRun
                    ? timeAgo(summary.latestRun.started_at)
                    : "—"}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Última execução</p>
              </div>
            </div>

            {/* Fontes sincronizadas */}
            <div className="flex items-center gap-3 bg-[#0d1117] border border-emerald-500/15 rounded-xl p-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/10">
                <CheckCircle2 size={15} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-slate-100 leading-none font-mono">
                  {loading ? "—" : `${summary.sourcesOk}/${EXPECTED_SOURCES.length}`}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Fontes sincronizadas</p>
              </div>
            </div>

            {/* Linhas carregadas */}
            <div className="flex items-center gap-3 bg-[#0d1117] border border-zinc-800/60 rounded-xl p-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-zinc-700/30">
                <Database size={15} className="text-zinc-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-slate-100 leading-none font-mono">
                  {loading ? "—" : summary.rowsLoaded.toLocaleString("pt-BR")}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Linhas carregadas</p>
              </div>
            </div>

            {/* Erros recentes */}
            <div className="flex items-center gap-3 bg-[#0d1117] border border-red-500/15 rounded-xl p-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10">
                <XCircle size={15} className="text-red-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-slate-100 leading-none font-mono">
                  {loading ? "—" : summary.recentErrors}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Erros (7d)</p>
              </div>
            </div>

            {/* Frescor dos dados */}
            <div className="flex items-center gap-3 bg-[#0d1117] border border-zinc-800/60 rounded-xl p-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-500/10">
                <Activity size={15} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100 leading-none font-mono">
                  {loading
                    ? "—"
                    : summary.latestFinished
                    ? timeAgo(summary.latestFinished)
                    : "—"}
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Frescor dos dados</p>
              </div>
            </div>
          </div>

          {/* Data source health detail */}
          {!loading && runs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {EXPECTED_SOURCES.map((src) => {
                const latest = latestPerExpectedSource(runs)[src];
                return (
                  <div
                    key={src}
                    className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5"
                  >
                    <LogStatusBadge
                      status={latest ? mapBadgeStatus(latest.status) : "pending"}
                      variant="dot"
                    />
                    <span className="text-[11px] font-mono text-zinc-400">{src}</span>
                    {latest && (
                      <span className="text-[10px] text-zinc-600 font-mono">
                        {formatDateShort(latest.started_at)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por data source, plataforma ou erro…"
                className="w-full pl-8 pr-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-600 rounded-xl text-xs text-slate-300 placeholder-zinc-600 outline-none transition-colors font-mono"
              />
            </div>

            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap
                    ${
                      statusFilter === f.id
                        ? "bg-zinc-700 text-slate-200"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
              <Filter size={11} className="text-zinc-500 flex-shrink-0" />
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="bg-transparent text-[11px] text-slate-300 outline-none cursor-pointer"
              >
                {sources.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900">
                    {s === "all" ? "Todos os data sources" : s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Result count / clear */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-zinc-600 font-mono">
              {loading
                ? "carregando…"
                : filtered.length === runs.length
                ? `${runs.length} registros`
                : `${filtered.length} de ${runs.length} registros`}
            </p>
            {(search || statusFilter !== "all" || sourceFilter !== "all") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setSourceFilter("all");
                }}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-4 animate-pulse">
                  <div className="w-4 h-4 bg-zinc-800 rounded" />
                  <div className="w-32 h-3 bg-zinc-800 rounded" />
                  <div className="w-40 h-3 bg-zinc-800 rounded" />
                  <div className="w-24 h-3 bg-zinc-800 rounded" />
                  <div className="w-16 h-3 bg-zinc-800 rounded ml-auto" />
                </div>
              ))}
            </div>
          ) : (
            <SyncRunsTable runs={filtered} />
          )}

          <p className="text-[10px] text-zinc-700 font-mono mt-4 text-center">
            Clique em qualquer linha para expandir os detalhes · últimos 50 registros
          </p>
        </main>
      </div>
    </div>
  );
}
