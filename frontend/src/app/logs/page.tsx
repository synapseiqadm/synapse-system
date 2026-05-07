"use client";
import { useState, useMemo } from "react";
import { Sidebar } from "../../components/Sidebar";
import { ExecutionLogTable, type ExecutionLog } from "../../components/ExecutionLogTable";
import { LogStatusBadge, type LogStatus } from "../../components/LogStatusBadge";
import {
  Terminal,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Download,
  RefreshCcw,
} from "lucide-react";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const ALL_LOGS: ExecutionLog[] = [
  {
    id: "LOG-250507-001",
    timestamp: "Hoje, 10:42",
    origin: "Growth Master",
    originType: "agent",
    action: "Ajuste de Orçamento",
    details:
      "Orçamento diário da campanha 'Black Friday - Prospecting' (Google Ads) aumentado de R$400 para R$460 (+15%). Gatilho: ROAS sustentado acima de 4.0x por 72h consecutivas.",
    impact: "+R$720/semana em receita projetada",
    status: "success",
    platform: "Google Ads",
    duration: "1.24s",
    query:
      "SELECT campaign_id, SUM(revenue)/SUM(spend) AS roas FROM fct_revenue WHERE date >= DATE_SUB(CURRENT_DATE, INTERVAL 3 DAY) GROUP BY 1",
  },
  {
    id: "LOG-250507-002",
    timestamp: "Hoje, 09:15",
    origin: "Anomaly Scout",
    originType: "agent",
    action: "Pausa de Anúncio",
    details:
      "Criativo 'Video_Promo_01' pausado no Meta Ads. Motivo: CAC excedeu o threshold de R$80,00 (valor registado: R$94,50) por 2 ciclos consecutivos de análise.",
    impact: "Economia estimada: R$189/dia em verba desperdiçada",
    status: "success",
    platform: "Meta Ads",
    duration: "0.87s",
  },
  {
    id: "LOG-250507-003",
    timestamp: "Hoje, 08:00",
    origin: "Sistema · Data Pipeline",
    originType: "system",
    action: "Sincronização RD Station",
    details:
      "Falha ao puxar leads do endpoint /contacts da API do RD Station. Token OAuth expirado. Pipeline interrompido. Nenhum dado escrito no BigQuery neste ciclo.",
    status: "failure",
    platform: "RD Station",
    duration: "12.04s",
    errorCode: "ERR_OAUTH_TOKEN_EXPIRED · HTTP 401 · Connector ID: rd-station-prod",
  },
  {
    id: "LOG-250507-004",
    timestamp: "Ontem, 18:30",
    origin: "Creative Critic",
    originType: "agent",
    action: "Sugestão de Copy",
    details:
      "Aguardando aprovação humana para injetar nova copy de Search Ads. Proposta: substituir headline 'Compre Agora' por 'Resultados em 7 dias — Garantido'. CTR médio esperado: +22% com base em histórico de variantes similares.",
    status: "pending",
    platform: "Google Ads",
    duration: "—",
  },
  {
    id: "LOG-250506-005",
    timestamp: "Ontem, 15:10",
    origin: "Sistema · BigQuery",
    originType: "system",
    action: "ETL fct_ad_spend",
    details:
      "Pipeline dbt executado com sucesso. Modelo fct_ad_spend materializado. 3 datasets fontes processados (raw_google_ads, raw_meta_ads, raw_ga4_sessions). 0 testes falharam.",
    impact: "24.820 linhas escritas · 3 datasets",
    status: "success",
    platform: "BigQuery",
    duration: "8.32s",
    query:
      "-- dbt run --select fct_ad_spend\nSELECT source, campaign_id, SUM(spend) AS total_spend, SUM(clicks) AS total_clicks FROM raw_google_ads GROUP BY 1,2",
  },
  {
    id: "LOG-250506-006",
    timestamp: "Ontem, 12:00",
    origin: "Growth Master",
    originType: "agent",
    action: "Realocação Revertida",
    details:
      "Realocação de R$300 da campanha 'Remarketing - 7D' para 'Lookalike 5%' revertida após 4h. Motivo: ROAS da campanha destino caiu abaixo do threshold logo após o aumento de orçamento.",
    status: "reverted",
    platform: "Google Ads",
    duration: "0.92s",
  },
  {
    id: "LOG-250506-007",
    timestamp: "Ontem, 09:00",
    origin: "Sistema · Data Pipeline",
    originType: "system",
    action: "Sincronização GA4",
    details:
      "Sessões, eventos e conversões dos últimos 7 dias importados com sucesso para o dataset raw_ga4_sessions no BigQuery.",
    impact: "9.340 sessões · 41.200 eventos",
    status: "success",
    platform: "GA4",
    duration: "5.18s",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | LogStatus;
type AgentFilter  = "all" | string;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [activeNav, setActiveNav]     = useState("logs");
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [agentFilter, setAgentFilter]   = useState<AgentFilter>("all");

  const origins = useMemo(() => {
    const unique = Array.from(new Set(ALL_LOGS.map((l) => l.origin)));
    return ["all", ...unique];
  }, []);

  const filtered = useMemo(() => {
    return ALL_LOGS.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false;
      if (agentFilter !== "all" && log.origin !== agentFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          log.action.toLowerCase().includes(q) ||
          log.origin.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q) ||
          log.id.toLowerCase().includes(q) ||
          (log.platform?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [search, statusFilter, agentFilter]);

  const successCount  = ALL_LOGS.filter((l) => l.status === "success").length;
  const failureCount  = ALL_LOGS.filter((l) => l.status === "failure").length;
  const pendingCount  = ALL_LOGS.filter((l) => l.status === "pending").length;
  const revertedCount = ALL_LOGS.filter((l) => l.status === "reverted").length;

  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all",      label: "Todos" },
    { id: "success",  label: "Sucesso" },
    { id: "failure",  label: "Falha" },
    { id: "pending",  label: "Pendente" },
    { id: "reverted", label: "Revertido" },
  ];

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-5 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <Terminal size={14} className="text-zinc-300" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Log de Execução</h1>
              <p className="text-[10px] text-zinc-500 font-mono">
                Audit trail · {ALL_LOGS.length} entradas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-slate-200 bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-600 rounded-lg transition-colors">
              <Download size={12} />
              Exportar CSV
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-zinc-400 hover:text-slate-200 bg-zinc-800/60 border border-zinc-700/60 hover:border-zinc-600 rounded-lg transition-colors">
              <RefreshCcw size={12} />
              Atualizar
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Sucesso",   value: successCount,  icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/15" },
              { label: "Falhas",    value: failureCount,  icon: XCircle,     color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/15" },
              { label: "Pendentes", value: pendingCount,  icon: Clock,       color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/15" },
              { label: "Revertidos",value: revertedCount, icon: Activity,    color: "text-slate-400",   bg: "bg-slate-700/20",   border: "border-slate-700/30" },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className={`flex items-center gap-3 bg-[#0d1117] border ${s.border} rounded-xl p-3`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg}`}>
                    <Icon size={15} className={s.color} />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-slate-100 leading-none font-mono">{s.value}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{s.label}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por campanha, agente ou ID..."
                className="w-full pl-8 pr-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 focus:border-zinc-600 rounded-xl text-xs text-slate-300 placeholder-zinc-600 outline-none transition-colors font-mono"
              />
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setStatusFilter(f.id)}
                  className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all whitespace-nowrap
                    ${statusFilter === f.id
                      ? "bg-zinc-700 text-slate-200"
                      : "text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Agent filter */}
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
              <Filter size={11} className="text-zinc-500 flex-shrink-0" />
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="bg-transparent text-[11px] text-slate-300 outline-none cursor-pointer"
              >
                {origins.map((o) => (
                  <option key={o} value={o} className="bg-zinc-900">
                    {o === "all" ? "Todos os agentes" : o}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Result count */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] text-zinc-600 font-mono">
              {filtered.length === ALL_LOGS.length
                ? `${ALL_LOGS.length} entradas`
                : `${filtered.length} de ${ALL_LOGS.length} entradas`
              }
            </p>
            {(search || statusFilter !== "all" || agentFilter !== "all") && (
              <button
                onClick={() => { setSearch(""); setStatusFilter("all"); setAgentFilter("all"); }}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {/* Table */}
          <ExecutionLogTable logs={filtered} />

          {/* Footer hint */}
          <p className="text-[10px] text-zinc-700 font-mono mt-4 text-center">
            Clique em qualquer linha para expandir os detalhes completos · Logs retidos por 90 dias
          </p>
        </main>
      </div>
    </div>
  );
}
