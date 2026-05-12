"use client";
import { useState, useEffect } from "react";
import { Sidebar } from "../../components/Sidebar";
import { AgentCard, type Agent } from "../../components/AgentCard";
import { AgentDecisionFeed, type Decision } from "../../components/AgentDecisionFeed";
import { Bot, Info, Loader2 } from "lucide-react";

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [activeNav, setActiveNav]         = useState("agents");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [decisions, setDecisions]         = useState<Decision[]>([]);
  const [loadingFeed, setLoadingFeed]     = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agents/decisions")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok && body.data) setDecisions(body.data as Decision[]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingFeed(false); });
    return () => { cancelled = true; };
  }, []);

  const pendingCount = decisions.filter((d) => d.status === "pending").length;

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
              <h1 className="text-sm font-bold text-slate-100">Centro de Operações</h1>
              <p className="text-[10px] text-slate-600">Diagnósticos IA · Decisões pendentes</p>
            </div>
          </div>

          {pendingCount > 0 && (
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
              {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
            </span>
          )}
        </header>

        {/* Body: 2-column layout */}
        <div className="flex flex-1 gap-0 overflow-hidden">
          {/* Left: disclaimer + agents */}
          <div className="flex flex-col w-[55%] overflow-y-auto p-5 border-r border-[#1a2540]">
            {/* Disclaimer banner */}
            <div className="flex items-start gap-3 bg-indigo-950/30 border border-indigo-800/30 rounded-xl px-4 py-3 mb-5">
              <Info size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-indigo-200/70 leading-relaxed">
                O feed de decisões reflecte alertas e recomendações reais gerados pelo motor de
                diagnóstico da SynapseIQ. Os agentes abaixo estão em fase de roadmap — as decisões
                actuais são produzidas pelo motor determinístico + Gemini 2.5 Flash.
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
            {loadingFeed ? (
              <div className="flex flex-col h-full bg-[#09090b] border border-[#1a2540] rounded-2xl items-center justify-center gap-3 text-slate-600">
                <Loader2 size={20} className="animate-spin" />
                <p className="text-xs">A carregar decisões...</p>
              </div>
            ) : (
              <AgentDecisionFeed
                decisions={decisions}
                filterAgentId={selectedAgent ?? undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
