"use client";
import { useState } from "react";
import { Sidebar } from "../../components/Sidebar";
import { WorkspaceSelector, WORKSPACES, type Workspace } from "../../components/WorkspaceSelector";
import { MetricCard, type MetricCardProps } from "../../components/MetricCard";
import {
  Bot,
  RefreshCw,
  AlertTriangle,
  TrendingDown,
  Lightbulb,
  CheckCircle2,
  Clock,
  ChevronRight,
  X,
} from "lucide-react";

// ─── Dados Simulados ────────────────────────────────────────────────────────

type Profile = "ceo" | "analyst";

const CEO_METRICS: MetricCardProps[] = [
  {
    title: "ROAS",
    value: "4.2",
    unit: "x",
    change: 8,
    changeLabel: "vs. 7 dias",
    source: "fct_revenue · fct_ad_spend",
    sparkline: [28, 35, 30, 42, 38, 45, 40, 52, 48, 58, 54, 62],
    highlight: true,
  },
  {
    title: "CAC",
    value: "R$124",
    change: -12,
    changeLabel: "vs. 7 dias",
    source: "fct_ad_spend · fct_leads",
    sparkline: [80, 75, 82, 70, 68, 72, 65, 60, 58, 55, 52, 48],
  },
  {
    title: "LTV Médio",
    value: "R$1.840",
    change: 3,
    changeLabel: "vs. 30 dias",
    source: "fct_revenue · dim_customers",
    sparkline: [55, 58, 57, 60, 62, 59, 63, 65, 64, 68, 70, 72],
  },
  {
    title: "Receita Total",
    value: "R$94.200",
    change: 22,
    changeLabel: "vs. 7 dias",
    source: "fct_revenue",
    sparkline: [40, 48, 44, 55, 52, 60, 58, 68, 65, 75, 72, 88],
  },
  {
    title: "Investimento",
    value: "R$22.400",
    change: -5,
    changeLabel: "vs. 7 dias",
    source: "fct_ad_spend",
    sparkline: [70, 68, 72, 65, 60, 58, 55, 52, 50, 48, 45, 44],
  },
  {
    title: "Margem ROAS",
    value: "3.8",
    unit: "x",
    change: 5,
    changeLabel: "vs. 7 dias",
    source: "fct_revenue · fct_ad_spend",
    sparkline: [32, 36, 34, 40, 38, 44, 42, 48, 46, 52, 50, 56],
  },
];

const ANALYST_METRICS: MetricCardProps[] = [
  {
    title: "CTR",
    value: "3.24",
    unit: "%",
    change: 11,
    changeLabel: "vs. 7 dias",
    source: "fct_ad_spend · raw_google_ads",
    sparkline: [22, 26, 24, 30, 28, 33, 31, 36, 34, 38, 37, 42],
    highlight: true,
  },
  {
    title: "CPC",
    value: "R$1.82",
    change: -7,
    changeLabel: "vs. 7 dias",
    source: "fct_ad_spend",
    sparkline: [72, 68, 70, 64, 60, 58, 55, 52, 50, 48, 46, 44],
  },
  {
    title: "Impressões",
    value: "2.4M",
    change: 18,
    changeLabel: "vs. 7 dias",
    source: "raw_google_ads · raw_meta_ads",
    sparkline: [38, 44, 41, 50, 47, 55, 53, 62, 60, 70, 68, 80],
  },
  {
    title: "Cliques",
    value: "78.2K",
    change: 12,
    changeLabel: "vs. 7 dias",
    source: "raw_google_ads · raw_meta_ads",
    sparkline: [35, 40, 38, 45, 43, 50, 48, 55, 53, 60, 58, 66],
  },
  {
    title: "Taxa de Conv.",
    value: "2.8",
    unit: "%",
    change: 4,
    changeLabel: "vs. 7 dias",
    source: "fct_leads · fct_ad_spend",
    sparkline: [40, 43, 41, 46, 44, 48, 47, 52, 50, 55, 54, 58],
  },
  {
    title: "CPL",
    value: "R$64.80",
    change: -9,
    changeLabel: "vs. 7 dias",
    source: "fct_leads · fct_ad_spend",
    sparkline: [75, 70, 72, 66, 62, 60, 57, 54, 51, 49, 46, 44],
  },
];

// ─── Agent Logs ─────────────────────────────────────────────────────────────

type LogLevel = "anomaly" | "suggestion" | "info" | "ok";

interface AgentLog {
  id: number;
  level: LogLevel;
  time: string;
  title: string;
  body: string;
  campaign?: string;
}

const AGENT_LOGS: AgentLog[] = [
  {
    id: 1,
    level: "anomaly",
    time: "09:41",
    title: "Anomalia detectada · Google Ads",
    body: "ROAS caiu 15% na campanha 'Black Friday - Retargeting' nos últimos 3 dias. Abaixo do threshold mínimo de 3.0x.",
    campaign: "Black Friday - Retargeting",
  },
  {
    id: 2,
    level: "suggestion",
    time: "09:41",
    title: "Sugestão de realocação",
    body: "Pausar AdSet #4521 e realocar R$1.200 para 'Top of Funnel - Prospecting' que está com ROAS de 5.8x.",
    campaign: "Top of Funnel - Prospecting",
  },
  {
    id: 3,
    level: "info",
    time: "08:30",
    title: "Destaque · Meta Ads",
    body: "CTR acima da média em 'Lookalike 2% - Compras': +34% vs. semana anterior. Audience scale recomendada.",
    campaign: "Lookalike 2% - Compras",
  },
  {
    id: 4,
    level: "ok",
    time: "07:00",
    title: "Sync concluído · BigQuery",
    body: "Pipeline fct_ad_spend executado com sucesso. 3 datasets atualizados. 0 erros.",
  },
];

const LOG_STYLE: Record<LogLevel, { icon: typeof AlertTriangle; color: string; bg: string; border: string }> = {
  anomaly:    { icon: AlertTriangle, color: "text-red-400",    bg: "bg-red-500/8",     border: "border-red-500/20" },
  suggestion: { icon: Lightbulb,     color: "text-amber-400",  bg: "bg-amber-500/8",   border: "border-amber-500/20" },
  info:       { icon: TrendingDown,  color: "text-indigo-400", bg: "bg-indigo-500/8",  border: "border-indigo-500/20" },
  ok:         { icon: CheckCircle2,  color: "text-emerald-400",bg: "bg-emerald-500/8", border: "border-emerald-500/20" },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [activeNav, setActiveNav]           = useState("dashboard");
  const [profile, setProfile]               = useState<Profile>("ceo");
  const [workspace, setWorkspace]           = useState<Workspace>(WORKSPACES[0]);
  const [agentOpen, setAgentOpen]           = useState(true);
  const [dismissedLogs, setDismissedLogs]   = useState<number[]>([]);

  const metrics = profile === "ceo" ? CEO_METRICS : ANALYST_METRICS;
  const visibleLogs = AGENT_LOGS.filter((l) => !dismissedLogs.includes(l.id));
  const anomalyCount = visibleLogs.filter((l) => l.level === "anomaly").length;

  return (
    <div className="flex h-screen bg-[#060a14] text-slate-200 overflow-hidden font-sans">
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-5 border-b border-[#1a2540] bg-[#07090f]/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <WorkspaceSelector selected={workspace} onSelect={setWorkspace} />
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#0d1530] border border-[#1a2540] rounded-lg">
              <RefreshCw size={10} className="text-emerald-400" />
              <span className="text-[10px] text-slate-500 font-mono">
                BQ sync · {workspace.lastSync}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Profile switch */}
            <div className="flex items-center bg-[#0d1530] border border-[#1a2540] rounded-xl p-1 gap-1">
              {(["ceo", "analyst"] as Profile[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProfile(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150
                    ${profile === p
                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                      : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  {p === "ceo" ? "Visão CEO" : "Visão Analista"}
                </button>
              ))}
            </div>

            {/* Agent toggle */}
            <button
              onClick={() => setAgentOpen(!agentOpen)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all
                ${agentOpen
                  ? "bg-violet-600/20 border-violet-500/30 text-violet-300"
                  : "bg-[#0d1530] border-[#1a2540] text-slate-400 hover:text-slate-200"
                }`}
            >
              <Bot size={14} />
              Agente IA
              {anomalyCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center">
                  {anomalyCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-5">
            {/* Page title */}
            <div className="mb-5">
              <h1 className="text-base font-bold text-slate-100">
                {profile === "ceo" ? "Performance Financeira" : "Performance de Mídia"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {workspace.name} · <span className="font-mono">{workspace.bqDataset}</span> · Últimos 7 dias
              </p>
            </div>

            {/* Metric grid */}
            <div className="grid grid-cols-3 gap-3">
              {metrics.map((m) => (
                <MetricCard key={m.title} {...m} />
              ))}
            </div>

            {/* Funnel bar chart */}
            <div className="mt-5 bg-[#0d1530] border border-[#1a2540] rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold text-slate-300">Funil de Conversão</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-0.5">fct_funnel_summary · 30 dias</p>
                </div>
                <span className="text-[10px] text-slate-600 bg-[#060a14] border border-[#1a2540] px-2 py-1 rounded-lg">
                  Impressões → Receita
                </span>
              </div>

              {[
                { label: "Impressões",  value: "2.4M",  pct: 100, color: "bg-indigo-500/60" },
                { label: "Cliques",     value: "78.2K", pct: 32,  color: "bg-indigo-500/70" },
                { label: "Leads",       value: "4.1K",  pct: 17,  color: "bg-violet-500/70" },
                { label: "Oportunidades",value: "820",  pct: 9,   color: "bg-violet-500/80" },
                { label: "Conversões",  value: "214",   pct: 5,   color: "bg-purple-500/80" },
                { label: "Receita",     value: "R$94K", pct: 3.5, color: "bg-fuchsia-500" },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 mb-2 last:mb-0">
                  <span className="text-[11px] text-slate-500 w-28 flex-shrink-0">{row.label}</span>
                  <div className="flex-1 h-5 bg-[#060a14] rounded-md overflow-hidden">
                    <div
                      className={`h-full rounded-md ${row.color} transition-all duration-500`}
                      style={{ width: `${row.pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-300 w-14 text-right">{row.value}</span>
                </div>
              ))}
            </div>
          </main>

          {/* Agent panel */}
          {agentOpen && (
            <aside className="w-80 flex-shrink-0 border-l border-[#1a2540] bg-[#07090f] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a2540]">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                    <Bot size={13} className="text-white" />
                  </div>
                  <p className="text-sm font-semibold text-slate-200">Agente de IA</p>
                </div>
                <div className="flex items-center gap-2">
                  {anomalyCount > 0 && (
                    <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full font-semibold">
                      {anomalyCount} anomalia{anomalyCount > 1 ? "s" : ""}
                    </span>
                  )}
                  <button onClick={() => setAgentOpen(false)} className="text-slate-600 hover:text-slate-400 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Context chip */}
              <div className="px-4 py-2 border-b border-[#1a2540]">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                  <Clock size={10} />
                  <span>Analisando <span className="text-indigo-400 font-mono">{workspace.bqDataset}</span> · {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>

              {/* Log list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {visibleLogs.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 text-slate-700">
                    <CheckCircle2 size={24} className="mb-2" />
                    <p className="text-xs">Nenhum alerta ativo</p>
                  </div>
                )}

                {visibleLogs.map((log) => {
                  const s = LOG_STYLE[log.level];
                  const Icon = s.icon;
                  return (
                    <div
                      key={log.id}
                      className={`relative rounded-xl p-3 border ${s.bg} ${s.border} group`}
                    >
                      <button
                        onClick={() => setDismissedLogs((d) => [...d, log.id])}
                        className="absolute top-2 right-2 text-slate-700 hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={11} />
                      </button>

                      <div className="flex items-start gap-2 mb-1.5">
                        <Icon size={13} className={`${s.color} flex-shrink-0 mt-0.5`} />
                        <p className={`text-[11px] font-semibold leading-tight ${s.color}`}>
                          {log.title}
                        </p>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{log.body}</p>

                      <div className="flex items-center justify-between">
                        {log.campaign && (
                          <span className="text-[9px] font-mono text-slate-600 bg-[#060a14] border border-[#1a2540] px-1.5 py-0.5 rounded truncate max-w-[160px]">
                            {log.campaign}
                          </span>
                        )}
                        <div className="flex items-center gap-1 ml-auto text-[9px] text-slate-700">
                          <Clock size={8} />
                          {log.time}
                        </div>
                      </div>

                      {log.level === "suggestion" && (
                        <button className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 rounded-lg text-[11px] text-amber-400 font-semibold transition-colors">
                          Aplicar sugestão <ChevronRight size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Input */}
              <div className="p-3 border-t border-[#1a2540]">
                <div className="flex items-center gap-2 bg-[#0d1530] border border-[#1a2540] rounded-xl px-3 py-2">
                  <input
                    type="text"
                    placeholder="Perguntar ao agente..."
                    className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none"
                  />
                  <button className="w-6 h-6 bg-indigo-600 hover:bg-indigo-500 rounded-lg flex items-center justify-center transition-colors flex-shrink-0">
                    <ChevronRight size={12} className="text-white" />
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
