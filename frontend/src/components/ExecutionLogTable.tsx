"use client";
import { useState } from "react";
import { LogStatusBadge, type LogStatus } from "./LogStatusBadge";
import {
  Bot,
  Server,
  ChevronDown,
  ChevronRight,
  Terminal,
  ArrowRight,
  DollarSign,
  AlertTriangle,
  Tag,
} from "lucide-react";

export interface ExecutionLog {
  id: string;
  timestamp: string;
  origin: string;
  originType: "agent" | "system";
  action: string;
  details: string;
  impact?: string;
  status: LogStatus;
  platform?: string;
  duration?: string;
  errorCode?: string;
  query?: string;
}

const PLATFORM_COLOR: Record<string, string> = {
  "Google Ads": "text-blue-400  bg-blue-500/10  border-blue-500/20",
  "Meta Ads":   "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
  "BigQuery":   "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  "RD Station": "text-violet-400 bg-violet-500/10 border-violet-500/20",
  "GA4":        "text-orange-400 bg-orange-500/10 border-orange-500/20",
};

interface RowProps {
  log: ExecutionLog;
  index: number;
}

function LogRow({ log, index }: RowProps) {
  const [expanded, setExpanded] = useState(false);

  const platformStyle = log.platform
    ? (PLATFORM_COLOR[log.platform] ?? "text-slate-400 bg-slate-700/20 border-slate-700/30")
    : null;

  return (
    <>
      {/* Main row */}
      <tr
        onClick={() => setExpanded(!expanded)}
        className={`border-b border-zinc-800/50 cursor-pointer transition-colors duration-100
          ${expanded ? "bg-zinc-900/60" : "hover:bg-zinc-900/40"}
          ${index % 2 === 0 ? "" : "bg-zinc-900/10"}
        `}
      >
        {/* Expand toggle */}
        <td className="pl-4 py-3 w-8">
          {expanded
            ? <ChevronDown size={13} className="text-zinc-500" />
            : <ChevronRight size={13} className="text-zinc-700 group-hover:text-zinc-500" />
          }
        </td>

        {/* Timestamp */}
        <td className="py-3 pr-4 whitespace-nowrap">
          <span className="font-mono text-[11px] text-zinc-400">{log.timestamp}</span>
        </td>

        {/* ID */}
        <td className="py-3 pr-4 whitespace-nowrap hidden md:table-cell">
          <span className="font-mono text-[10px] text-zinc-600 bg-zinc-800/60 border border-zinc-700/40 px-1.5 py-0.5 rounded">
            {log.id}
          </span>
        </td>

        {/* Origin */}
        <td className="py-3 pr-4 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {log.originType === "agent"
              ? <Bot size={12} className="text-violet-400 flex-shrink-0" />
              : <Server size={12} className="text-slate-500 flex-shrink-0" />
            }
            <span className="text-[11px] font-medium text-slate-300">{log.origin}</span>
          </div>
        </td>

        {/* Action */}
        <td className="py-3 pr-4">
          <span className="text-[12px] font-semibold text-slate-200">{log.action}</span>
        </td>

        {/* Platform */}
        <td className="py-3 pr-4 whitespace-nowrap hidden lg:table-cell">
          {platformStyle && log.platform ? (
            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${platformStyle}`}>
              <Tag size={9} />
              {log.platform}
            </span>
          ) : (
            <span className="text-zinc-700 text-[11px]">—</span>
          )}
        </td>

        {/* Duration */}
        <td className="py-3 pr-4 whitespace-nowrap hidden xl:table-cell">
          <span className="font-mono text-[11px] text-zinc-600">
            {log.duration ?? "—"}
          </span>
        </td>

        {/* Status */}
        <td className="py-3 pr-4 whitespace-nowrap">
          <LogStatusBadge status={log.status} />
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="border-b border-zinc-800/50 bg-zinc-900/30">
          <td colSpan={8} className="px-6 pb-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-4">
              {/* Details */}
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold mb-1.5">
                  Detalhes
                </p>
                <p className="text-[12px] text-slate-300 leading-relaxed">{log.details}</p>
              </div>

              {/* Impact */}
              {log.impact && (
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold mb-1.5 flex items-center gap-1">
                    <DollarSign size={9} /> Impacto estimado
                  </p>
                  <p className="text-[12px] text-emerald-400 font-semibold">{log.impact}</p>
                </div>
              )}

              {/* Error code */}
              {log.errorCode && (
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold mb-1.5 flex items-center gap-1">
                    <AlertTriangle size={9} /> Código de erro
                  </p>
                  <span className="font-mono text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded">
                    {log.errorCode}
                  </span>
                </div>
              )}

              {/* BigQuery query */}
              {log.query && (
                <div className="md:col-span-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold mb-1.5 flex items-center gap-1">
                    <Terminal size={9} /> Query executada · BigQuery
                  </p>
                  <div className="bg-[#060a14] border border-zinc-800 rounded-lg px-3 py-2">
                    <p className="font-mono text-[11px] text-emerald-400/80">{log.query}</p>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface ExecutionLogTableProps {
  logs: ExecutionLog[];
}

export function ExecutionLogTable({ logs }: ExecutionLogTableProps) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
        <Terminal size={28} className="mb-3" />
        <p className="text-sm font-medium">Nenhum log encontrado</p>
        <p className="text-xs mt-1">Tente ajustar os filtros de busca</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full min-w-[700px] border-collapse">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/60">
            <th className="pl-4 py-2.5 w-8" />
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest whitespace-nowrap">
              Data / Hora
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest hidden md:table-cell">
              ID
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              Origem
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              Ação
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest hidden lg:table-cell">
              Plataforma
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest hidden xl:table-cell">
              Duração
            </th>
            <th className="text-left py-2.5 pr-4 text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => (
            <LogRow key={log.id} log={log} index={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
