"use client";
import { useState } from "react";
import {
  Database,
  Lightbulb,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Bot,
} from "lucide-react";

export type DecisionType   = "analysis" | "suggestion" | "action" | "alert";
export type DecisionStatus = "pending" | "approved" | "rejected" | "auto-applied";

export interface Decision {
  id: number;
  agentId: string;
  agentName: string;
  type: DecisionType;
  title: string;
  body: string;
  timestamp: string;
  status: DecisionStatus;
  value?: string;
  query?: string;
  rationale?: string;
}

const TYPE_CFG: Record<DecisionType, {
  icon: typeof Database;
  color: string;
  bg: string;
  border: string;
  label: string;
}> = {
  analysis:   { icon: Database,      color: "text-indigo-400",  bg: "bg-indigo-500/10",  border: "border-indigo-500/20",  label: "Análise BQ" },
  suggestion: { icon: Lightbulb,     color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20",   label: "Sugestão" },
  action:     { icon: Zap,           color: "text-violet-400",  bg: "bg-violet-500/10",  border: "border-violet-500/20",  label: "Ação" },
  alert:      { icon: AlertTriangle, color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20",     label: "Alerta" },
};

const FILTERS: { id: DecisionType | "all"; label: string }[] = [
  { id: "all",        label: "Todos" },
  { id: "alert",      label: "Alertas" },
  { id: "suggestion", label: "Sugestões" },
  { id: "analysis",   label: "Análises" },
  { id: "action",     label: "Ações" },
];

interface AgentDecisionFeedProps {
  decisions: Decision[];
  filterAgentId?: string;
}

export function AgentDecisionFeed({ decisions, filterAgentId }: AgentDecisionFeedProps) {
  const [states, setStates]       = useState<Record<number, DecisionStatus>>({});
  const [typeFilter, setTypeFilter] = useState<DecisionType | "all">("all");

  const resolve = (id: number, status: "approved" | "rejected") => {
    setStates((s) => ({ ...s, [id]: status }));
  };

  const getStatus = (d: Decision): DecisionStatus => states[d.id] ?? d.status;

  const visible = decisions.filter((d) => {
    if (filterAgentId && d.agentId !== filterAgentId) return false;
    if (typeFilter !== "all" && d.type !== typeFilter) return false;
    return true;
  });

  const pendingCount = decisions.filter((d) => getStatus(d) === "pending").length;

  return (
    <div className="flex flex-col h-full bg-[#09090b] border border-[#1a2540] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a2540] flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-600/20 border border-violet-500/25 flex items-center justify-center">
            <Bot size={13} className="text-violet-400" />
          </div>
          <p className="text-sm font-semibold text-slate-200">Feed de Decisões</p>
          {pendingCount > 0 && (
            <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <Filter size={13} className="text-slate-600" />
      </div>

      {/* Type filters */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#1a2540] overflow-x-auto flex-shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setTypeFilter(f.id as DecisionType | "all")}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap transition-all
              ${typeFilter === f.id
                ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/25"
                : "text-slate-500 hover:text-slate-300 border border-transparent"
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-slate-700">
            <CheckCircle2 size={22} className="mb-2" />
            <p className="text-xs">Nenhuma decisão encontrada</p>
          </div>
        )}

        {visible.map((d, idx) => {
          const cfg    = TYPE_CFG[d.type];
          const Icon   = cfg.icon;
          const status = getStatus(d);
          const isPending = status === "pending";
          const isApproved = status === "approved" || status === "auto-applied";
          const isRejected = status === "rejected";

          return (
            <div key={d.id} className="relative flex gap-3">
              {/* Timeline line */}
              {idx < visible.length - 1 && (
                <div className="absolute left-[18px] top-8 bottom-0 w-px bg-[#1a2540]" />
              )}

              {/* Icon */}
              <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${cfg.bg} ${cfg.border}`}>
                <Icon size={15} className={cfg.color} />
              </div>

              {/* Content */}
              <div className={`flex-1 rounded-xl p-3 border transition-all duration-200
                ${isPending  ? `${cfg.bg} ${cfg.border}` :
                  isApproved ? "bg-emerald-500/5 border-emerald-500/15" :
                               "bg-slate-900/50 border-[#1a2540] opacity-60"}
              `}>
                {/* Row 1: agent + type + time */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-400">{d.agentName}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-slate-700">
                    <Clock size={8} />
                    {d.timestamp}
                  </div>
                </div>

                {/* Title */}
                <p className="text-xs font-semibold text-slate-200 mb-1">{d.title}</p>

                {/* Body */}
                <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{d.body}</p>

                {/* SQL query chip */}
                {d.query && (
                  <div className="mb-2 bg-[#060a14] border border-[#1a2540] rounded-lg px-2.5 py-1.5 font-mono">
                    <p className="text-[9px] text-slate-600 mb-0.5">BigQuery SQL</p>
                    <p className="text-[10px] text-emerald-400/80 truncate">{d.query}</p>
                  </div>
                )}

                {/* Value chip */}
                {d.value && (
                  <div className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg mb-2">
                    <Zap size={9} />
                    {d.value}
                  </div>
                )}

                {/* Rationale chip */}
                {d.rationale && (
                  <div className="mb-2 bg-[#060a14] border border-[#1a2540] rounded-lg px-2.5 py-1.5">
                    <p className="text-[9px] text-slate-600 mb-0.5 uppercase tracking-wide font-semibold">Raciocínio</p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{d.rationale}</p>
                  </div>
                )}

                {/* Action buttons for pending suggestions/actions */}
                {isPending && (d.type === "suggestion" || d.type === "action") && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => resolve(d.id, "approved")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/25 rounded-lg text-[11px] text-emerald-400 font-semibold transition-colors"
                    >
                      <CheckCircle2 size={11} /> Aprovar
                    </button>
                    <button
                      onClick={() => resolve(d.id, "rejected")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-[11px] text-red-400 font-semibold transition-colors"
                    >
                      <XCircle size={11} /> Rejeitar
                    </button>
                  </div>
                )}

                {/* Resolved state */}
                {!isPending && (
                  <div className={`flex items-center gap-1.5 text-[10px] font-semibold mt-1
                    ${isApproved ? "text-emerald-400" : "text-slate-600"}`}>
                    {isApproved ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                    {status === "auto-applied" ? "Aplicado automaticamente" : isApproved ? "Aprovado" : "Rejeitado"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
