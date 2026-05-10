"use client";
import { useState } from "react";
import { Bot, Zap, AlertTriangle, ShieldCheck, ChevronRight, Clock, Activity } from "lucide-react";

export type AgentStatus = "autonomous" | "alert" | "suggestion" | "paused" | "preview";
export type AgentMode   = "auto" | "manual";

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  defaultMode: AgentMode;
  lastAction: string;
  metrics: string[];
  actionsToday: number;
  successRate: number;
  icon: "bot" | "zap" | "alert" | "shield";
}

const STATUS_CFG: Record<AgentStatus, {
  label: string;
  dot: string;
  badge: string;
  glow: string;
  border: string;
}> = {
  autonomous: {
    label: "Autônomo",
    dot:   "bg-violet-400 animate-pulse",
    badge: "bg-violet-500/15 text-violet-300 border-violet-500/25",
    glow:  "shadow-[0_0_24px_rgba(139,92,246,0.18)]",
    border:"border-violet-500/30",
  },
  alert: {
    label: "Alerta",
    dot:   "bg-red-400 animate-pulse",
    badge: "bg-red-500/15 text-red-300 border-red-500/25",
    glow:  "shadow-[0_0_24px_rgba(239,68,68,0.18)]",
    border:"border-red-500/30",
  },
  suggestion: {
    label: "Sugestão",
    dot:   "bg-amber-400",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    glow:  "shadow-[0_0_24px_rgba(245,158,11,0.12)]",
    border:"border-amber-500/25",
  },
  paused: {
    label: "Pausado",
    dot:   "bg-slate-600",
    badge: "bg-slate-700/40 text-slate-500 border-slate-700/40",
    glow:  "",
    border:"border-[#1a2540]",
  },
  preview: {
    label: "Preview",
    dot:   "bg-indigo-400/50",
    badge: "bg-indigo-500/10 text-indigo-300/70 border-indigo-500/15",
    glow:  "",
    border:"border-zinc-700/50",
  },
};

const ICONS = {
  bot:    Bot,
  zap:    Zap,
  alert:  AlertTriangle,
  shield: ShieldCheck,
};

interface AgentCardProps {
  agent: Agent;
  onSelect: (id: string) => void;
  selected: boolean;
}

export function AgentCard({ agent, onSelect, selected }: AgentCardProps) {
  const [mode, setMode] = useState<AgentMode>(agent.defaultMode);
  const cfg  = STATUS_CFG[agent.status];
  const Icon = ICONS[agent.icon];

  return (
    <div
      onClick={() => onSelect(agent.id)}
      className={`relative flex flex-col bg-[#0d1117] border rounded-2xl p-5 cursor-pointer transition-all duration-200
        ${cfg.glow} ${selected ? cfg.border : "border-[#1a2540] hover:" + cfg.border}
        ${agent.status === "paused" ? "opacity-60" : ""}
      `}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
            ${agent.status === "autonomous" ? "bg-violet-600/20 border border-violet-500/30" :
              agent.status === "alert"      ? "bg-red-600/20 border border-red-500/30" :
              agent.status === "suggestion" ? "bg-amber-600/20 border border-amber-500/30" :
                                             "bg-slate-800 border border-slate-700"}
          `}>
            <Icon size={18} className={
              agent.status === "autonomous" ? "text-violet-400" :
              agent.status === "alert"      ? "text-red-400" :
              agent.status === "suggestion" ? "text-amber-400" :
                                             "text-slate-600"
            } />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-100">{agent.name}</p>
            <p className="text-[11px] text-slate-500">{agent.role}</p>
          </div>
        </div>

        {/* Status badge */}
        <span className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed mb-4">{agent.description}</p>

      {/* Metrics chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {agent.metrics.map((m) => (
          <span key={m} className="text-[10px] font-mono text-slate-500 bg-[#060a14] border border-[#1a2540] px-2 py-0.5 rounded-md">
            {m}
          </span>
        ))}
      </div>

      {/* Stats row — hidden in preview mode */}
      {agent.status !== "preview" && (
        <div className="flex items-center gap-4 mb-4 pb-4 border-b border-[#1a2540]">
          <div className="flex items-center gap-1.5">
            <Activity size={11} className="text-slate-600" />
            <span className="text-[11px] text-slate-500">
              <span className="text-slate-300 font-semibold">{agent.actionsToday}</span> ações hoje
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={11} className="text-slate-600" />
            <span className="text-[11px] text-slate-500">
              <span className="text-emerald-400 font-semibold">{agent.successRate}%</span> sucesso
            </span>
          </div>
        </div>
      )}

      {/* Footer: mode toggle + last action — hidden in preview mode */}
      {agent.status !== "preview" && (
        <div className="flex items-center justify-between">
          <div
            onClick={(e) => { e.stopPropagation(); setMode(m => m === "auto" ? "manual" : "auto"); }}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0
              ${mode === "auto" ? "bg-violet-600" : "bg-slate-700"}
            `}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200
                ${mode === "auto" ? "left-[18px]" : "left-0.5"}
              `} />
            </div>
            <span className={`text-[11px] font-semibold transition-colors ${mode === "auto" ? "text-violet-300" : "text-slate-500"}`}>
              {mode === "auto" ? "Automático" : "Manual"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock size={10} className="text-slate-700" />
            <span className="text-[10px] text-slate-600">{agent.lastAction}</span>
            <ChevronRight size={12} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
          </div>
        </div>
      )}
    </div>
  );
}
