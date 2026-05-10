"use client";
import { useState } from "react";
import { Sidebar } from "../../components/Sidebar";
import { AgentCard, type Agent } from "../../components/AgentCard";
import { AgentDecisionFeed, type Decision } from "../../components/AgentDecisionFeed";
import { Bot, Info } from "lucide-react";

// ─── Static Data ─────────────────────────────────────────────────────────────

const AGENTS: Agent[] = [
  {
    id: "growth-master",
    name: "Growth Master",
    role: "Otimização de ROAS",
    description:
      "Monitora continuamente o ROAS por campanha no BigQuery e realoca verbas automaticamente entre adsets para maximizar o retorno sobre investimento.",
    status: "preview",
    defaultMode: "manual",
    lastAction: "",
    metrics: ["fct_ad_spend", "fct_revenue", "ROAS", "Budget Allocation"],
    actionsToday: 0,
    successRate: 0,
    icon: "zap",
  },
  {
    id: "anomaly-scout",
    name: "Anomaly Scout",
    role: "Detecção de Anomalias",
    description:
      "Aplica análise de séries temporais sobre os dados do BigQuery para detectar picos anômalos de CAC, quedas abruptas de conversão ou desvios de CTR.",
    status: "preview",
    defaultMode: "manual",
    lastAction: "",
    metrics: ["CAC", "Conv. Rate", "CTR", "raw_google_ads"],
    actionsToday: 0,
    successRate: 0,
    icon: "alert",
  },
  {
    id: "creative-critic",
    name: "Creative Critic",
    role: "Performance de Criativos",
    description:
      "Analisa métricas de engajamento de banners e vídeos no Google Ads. Sugere pausar criativos abaixo do benchmarking e escalar os de melhor performance.",
    status: "preview",
    defaultMode: "manual",
    lastAction: "",
    metrics: ["CTR por criativo", "Hook Rate", "fct_creatives"],
    actionsToday: 0,
    successRate: 0,
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
  const [activeNav, setActiveNav]         = useState("agents");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

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
              <p className="text-[10px] text-slate-600">Roadmap de produto · Visão planejada</p>
            </div>
          </div>

          <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-300/80 border border-indigo-500/15">
            Preview
          </span>
        </header>

        {/* Body: 2-column layout */}
        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Left: disclaimer + agents */}
          <div className="flex flex-col w-[55%] overflow-y-auto p-5 border-r border-[#1a2540]">
            {/* Disclaimer banner */}
            <div className="flex items-start gap-3 bg-indigo-950/30 border border-indigo-800/30 rounded-xl px-4 py-3 mb-5">
              <Info size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-indigo-200/70 leading-relaxed">
                Esta área apresenta a visão planejada para a camada de agentes de IA do SynapseIQ.
                Nesta versão, os insights disponíveis no dashboard são determinísticos e baseados em regras.
                Nenhum agente autônomo está ativo em produção neste momento.
              </p>
            </div>

            {/* Agent cards */}
            <p className="text-[11px] text-slate-600 uppercase tracking-widest font-semibold mb-3">
              Agentes planejados
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
