"use client";
import { useState } from "react";
import { Sidebar } from "../../components/Sidebar";
import { AgentCard, type Agent } from "../../components/AgentCard";
import { AgentDecisionFeed, type Decision } from "../../components/AgentDecisionFeed";
import { Bot, Zap, ShieldCheck, Activity, TrendingUp, Play, Pause } from "lucide-react";

// ─── Static Data ─────────────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  {
    id: "growth-master",
    name: "Growth Master",
    role: "Otimização de ROAS",
    description:
      "Monitora continuamente o ROAS por campanha no BigQuery e realoca verbas automaticamente entre adsets para maximizar o retorno sobre investimento.",
    status: "autonomous",
    defaultMode: "auto",
    lastAction: "há 4 min",
    metrics: ["fct_ad_spend", "fct_revenue", "ROAS", "Budget Allocation"],
    actionsToday: 7,
    successRate: 94,
    icon: "zap",
  },
  {
    id: "anomaly-scout",
    name: "Anomaly Scout",
    role: "Detecção de Anomalias",
    description:
      "Aplica análise de séries temporais sobre os dados do BigQuery para detectar picos anômalos de CAC, quedas abruptas de conversão ou desvios de CTR.",
    status: "alert",
    defaultMode: "manual",
    lastAction: "há 12 min",
    metrics: ["CAC", "Conv. Rate", "CTR", "raw_google_ads"],
    actionsToday: 3,
    successRate: 88,
    icon: "alert",
  },
  {
    id: "creative-critic",
    name: "Creative Critic",
    role: "Performance de Criativos",
    description:
      "Analisa métricas de engajamento de banners e vídeos no Google Ads. Sugere pausar criativos abaixo do benchmarking e escalar os de melhor performance.",
    status: "suggestion",
    defaultMode: "manual",
    lastAction: "há 28 min",
    metrics: ["CTR por criativo", "Hook Rate", "fct_creatives"],
    actionsToday: 2,
    successRate: 81,
    icon: "shield",
  },
];

const DECISIONS: Decision[] = [
  {
    id: 1,
    agentId: "growth-master",
    agentName: "Growth Master",
    type: "analysis",
    title: "Análise de SQL no BigQuery concluída",
    body: "ROAS da campanha 'Prospecting LAL 3%' subiu 20% nas últimas 48h. Volume de conversões acima da média histórica.",
    timestamp: "09:44",
    status: "auto-applied",
    query: "SELECT campaign_id, SUM(revenue)/SUM(spend) AS roas FROM fct_revenue GROUP BY 1",
  },
  {
    id: 2,
    agentId: "growth-master",
    agentName: "Growth Master",
    type: "suggestion",
    title: "Realocar verba — campanha de baixo ROAS",
    body: "Campanha 'Retargeting - 30D Visitantes' apresenta ROAS de 1.8x (abaixo do threshold de 3.0x). Sugestão: mover R$200/dia para 'Prospecting LAL 3%'.",
    timestamp: "09:44",
    status: "pending",
    value: "Impacto estimado: +R$360/dia em receita",
  },
  {
    id: 3,
    agentId: "anomaly-scout",
    agentName: "Anomaly Scout",
    type: "alert",
    title: "Anomalia crítica detectada — CAC +68%",
    body: "CAC da conta Google Ads subiu de R$124 para R$208 nas últimas 6 horas. Possível causa: leilão competitivo ou fadiga de público.",
    timestamp: "09:31",
    status: "pending",
    value: "CAC atual: R$208 (threshold: R$150)",
  },
  {
    id: 4,
    agentId: "anomaly-scout",
    agentName: "Anomaly Scout",
    type: "action",
    title: "Pausar AdSet com CAC crítico",
    body: "Solicita pausa do AdSet ID #4521 ('Interesse - Empreendedores 35-54') até normalização do leilão. CAC 41% acima do limite aceitável.",
    timestamp: "09:32",
    status: "pending",
    value: "Economia estimada: R$480 em verba",
  },
  {
    id: 5,
    agentId: "creative-critic",
    agentName: "Creative Critic",
    type: "suggestion",
    title: "Pausar 3 criativos abaixo do benchmark",
    body: "Vídeo 'VSL_30s_v2' e banners 'Static_1080_A/B' com CTR < 0.8% por 7 dias consecutivos. Benchmark da conta: 2.1%. Criativos sugeridos para escalar: 'Carrossel_Depoimentos_v3'.",
    timestamp: "08:58",
    status: "pending",
    value: "CTR médio dos top criativos: 3.4%",
  },
  {
    id: 6,
    agentId: "growth-master",
    agentName: "Growth Master",
    type: "action",
    title: "Budget auto-ajustado — campanha top performer",
    body: "Orçamento diário de 'Prospecting LAL 2%' aumentado de R$400 para R$520 (+30%). ROAS 5.2x sustentado por 72h consecutivas.",
    timestamp: "07:00",
    status: "auto-applied",
    value: "+R$120/dia realocados automaticamente",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [activeNav, setActiveNav]       = useState("agents");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [allPaused, setAllPaused]         = useState(false);

  const activeAgents    = AGENTS.filter((a) => a.status !== "paused").length;
  const alertCount      = AGENTS.filter((a) => a.status === "alert").length;
  const pendingDecisions = DECISIONS.filter((d) => d.status === "pending").length;

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-5 border-b border-[#1a2540] bg-[#09090b]/80 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <Bot size={15} className="text-violet-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Agentes de IA</h1>
              <p className="text-[10px] text-slate-600">LangChain · GPT-4o · BigQuery</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats pills */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-[#0d1117] border border-[#1a2540] px-2.5 py-1 rounded-lg">
                <Activity size={11} className="text-violet-400" />
                <span className="font-semibold text-violet-300">{activeAgents}</span> ativos
              </span>
              {alertCount > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-lg font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  {alertCount} alerta{alertCount > 1 ? "s" : ""}
                </span>
              )}
              {pendingDecisions > 0 && (
                <span className="flex items-center gap-1.5 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg font-semibold">
                  {pendingDecisions} pendente{pendingDecisions > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Global pause */}
            <button
              onClick={() => setAllPaused(!allPaused)}
              className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all
                ${allPaused
                  ? "bg-emerald-600/20 border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30"
                  : "bg-red-600/10 border-red-500/20 text-red-400 hover:bg-red-600/20"
                }`}
            >
              {allPaused ? <Play size={13} /> : <Pause size={13} />}
              {allPaused ? "Retomar todos" : "Pausar todos"}
            </button>
          </div>
        </header>

        {/* Body: 2-column layout */}
        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Left: agents + summary */}
          <div className="flex flex-col w-[55%] overflow-y-auto p-5 border-r border-[#1a2540]">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Ações hoje",       value: AGENTS.reduce((s, a) => s + a.actionsToday, 0).toString(), icon: Zap,         color: "text-violet-400", bg: "bg-violet-500/10" },
                { label: "Taxa de sucesso",  value: `${Math.round(AGENTS.reduce((s, a) => s + a.successRate, 0) / AGENTS.length)}%`, icon: TrendingUp, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                { label: "Decisões pendentes",value: pendingDecisions.toString(), icon: ShieldCheck, color: "text-amber-400",  bg: "bg-amber-500/10" },
              ].map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="flex items-center gap-3 bg-[#0d1117] border border-[#1a2540] rounded-xl p-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.bg}`}>
                      <Icon size={15} className={stat.color} />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-100 leading-none">{stat.value}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{stat.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Agent cards */}
            <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">
              Agentes configurados
            </p>
            <div className="space-y-3">
              {AGENTS.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgent === agent.id}
                  onSelect={(id) => setSelectedAgent(selectedAgent === id ? null : id)}
                />
              ))}
            </div>
          </div>

          {/* Right: decision feed */}
          <div className="flex-1 overflow-hidden p-5">
            <AgentDecisionFeed
              decisions={DECISIONS}
              filterAgentId={selectedAgent ?? undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
