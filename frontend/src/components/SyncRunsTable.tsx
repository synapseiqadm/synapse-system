"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Database, AlertTriangle } from "lucide-react";
import { LogStatusBadge } from "./LogStatusBadge";
import {
  type SyncRun,
  mapBadgeStatus,
  formatDateShort,
  runDuration,
} from "@/lib/api/sync_runs";

function ExpandedDetail({ run }: { run: SyncRun }) {
  return (
    <div className="px-10 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
      {run.error_message && (
        <div className="sm:col-span-3 flex items-start gap-2 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-red-300 font-mono break-all">{run.error_message}</p>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Plataforma</p>
        <p className="text-xs text-slate-300 font-mono">{run.source_platform || "—"}</p>
      </div>
      <div className="space-y-1">
        <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Linhas carregadas</p>
        <p className="text-xs text-slate-300 font-mono">
          {run.rows_loaded != null ? run.rows_loaded.toLocaleString("pt-BR") : "—"}
        </p>
      </div>
      {run.date_range_start && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Período dos dados</p>
          <p className="text-xs text-slate-300 font-mono">
            {run.date_range_start} → {run.date_range_end ?? "?"}
          </p>
        </div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: SyncRun }) {
  const [expanded, setExpanded] = useState(false);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;
  const badge = mapBadgeStatus(run.status);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors cursor-pointer select-none"
      >
        <td className="pl-3 pr-2 py-3 w-8">
          <ChevronIcon size={12} className="text-zinc-600" />
        </td>
        <td className="px-3 py-3 text-[11px] text-zinc-400 font-mono whitespace-nowrap">
          {formatDateShort(run.started_at)}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center flex-shrink-0">
              <Database size={10} className="text-zinc-400" />
            </div>
            <span className="text-[11px] font-mono text-slate-300">{run.data_source}</span>
          </div>
        </td>
        <td className="px-3 py-3 text-[11px] text-zinc-500 font-mono">{run.source_platform}</td>
        <td className="px-3 py-3">
          <LogStatusBadge status={badge} />
        </td>
        <td className="px-3 py-3 text-[11px] text-zinc-500 font-mono text-right tabular-nums">
          {run.rows_loaded != null ? run.rows_loaded.toLocaleString("pt-BR") : "—"}
        </td>
        <td className="px-3 py-3 text-[11px] text-zinc-500 font-mono text-right tabular-nums">
          {runDuration(run.started_at, run.finished_at)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-zinc-900/20 border-t border-zinc-800/40">
          <td colSpan={7} className="p-0">
            <ExpandedDetail run={run} />
          </td>
        </tr>
      )}
    </>
  );
}

type Props = {
  runs: SyncRun[];
};

export function SyncRunsTable({ runs }: Props) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border border-zinc-800 rounded-xl">
        <Database size={28} className="text-zinc-700 mb-3" />
        <p className="text-sm text-zinc-500">Nenhuma execução encontrada para este workspace.</p>
        <p className="text-[11px] text-zinc-700 font-mono mt-1">tabela sync_runs · sem registros</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-zinc-900/60">
            <th className="pl-3 pr-2 py-2.5 w-8" />
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">
              Início
            </th>
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              Data Source
            </th>
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              Plataforma
            </th>
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              Status
            </th>
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-right">
              Linhas
            </th>
            <th className="px-3 py-2.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide text-right">
              Duração
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
