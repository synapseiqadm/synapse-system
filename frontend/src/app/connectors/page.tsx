"use client";
import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "../../components/Sidebar";
import { ConnectorCard, type Connector, type ConnectorStatus } from "../../components/ConnectorCard";
import {
  RefreshCcw,
  Loader2,
  Database,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Cloud,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

// ─── Platform Logos ───────────────────────────────────────────────────────────

function GoogleAdsLogo() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
        <path d="M2.5 19.5L8 10l4 7H2.5z" fill="#FBBC04" />
        <path d="M8 10l5.5-9.5 5.5 9.5H8z" fill="#4285F4" />
        <path d="M13.5 0.5L19 10l-5.5 9.5" stroke="#34A853" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function GA4Logo() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
        <rect x="3" y="12" width="4" height="9" rx="1" fill="#F37C20" opacity="0.5"/>
        <rect x="10" y="7" width="4" height="14" rx="1" fill="#F37C20" opacity="0.75"/>
        <rect x="17" y="2" width="4" height="19" rx="1" fill="#F37C20"/>
      </svg>
    </div>
  );
}

function MetaLogo() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none">
        <path
          d="M2 12.9C2 16.8 4.5 20 7.5 20c1.4 0 2.6-.7 3.5-1.8.9 1.1 2.1 1.8 3.5 1.8C17.5 20 20 16.8 20 12.9 20 9 17.5 5 14.5 5c-1.4 0-2.6.8-3.5 2C10.1 5.8 8.9 5 7.5 5 4.5 5 2 9 2 12.9z"
          stroke="#1877F2" strokeWidth="1.5" fill="none"
        />
        <ellipse cx="8" cy="13" rx="2" ry="3" fill="#1877F2" opacity="0.6"/>
        <ellipse cx="16" cy="13" rx="2" ry="3" fill="#1877F2" opacity="0.6"/>
      </svg>
    </div>
  );
}

function RDLogo() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
        <span className="text-[10px] font-black text-white tracking-tight">RD</span>
      </div>
    </div>
  );
}

// ─── Static planned connectors (no pipeline) ──────────────────────────────────

const STATIC_CONNECTORS: Connector[] = [
  {
    id:          "meta-ads",
    name:        "Meta Ads",
    description: "Facebook Ads, Instagram Ads — métricas de reach e conversão",
    status:      "disconnected",
    logo:        <MetaLogo />,
  },
  {
    id:          "rd-station",
    name:        "RD Station CRM",
    description: "Leads, oportunidades, funil de vendas e receita fechada",
    status:      "disconnected",
    logo:        <RDLogo />,
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackingIssue = { check_name: string; status: string; severity: string };

type ConnectorData = {
  status:       ConnectorStatus;
  lastSync:     string | null;
  rowsLoaded:   number;
  errorMessage: string | null;
  quality:      { passed: number; warning: number; failed: number; total: number };
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ConnectorsPage() {
  const [activeNav, setActiveNav]         = useState("connectors");
  const [connectors, setConnectors]       = useState<Connector[]>([]);
  const [trackingIssues, setTrackingIssues] = useState<TrackingIssue[]>([]);
  const [loading, setLoading]             = useState(true);
  const [syncingIds, setSyncingIds]       = useState<Set<string>>(new Set());
  const [globalSyncing, setGlobalSyncing] = useState(false);

  const buildConnectors = useCallback((gAds: ConnectorData, ga4: ConnectorData): Connector[] => [
    {
      id:              "google-ads",
      name:            "Google Ads",
      description:     "Campanhas, adsets, criativos e métricas de spend",
      status:          gAds.status,
      lastSync:        gAds.lastSync ?? undefined,
      bqDataset:       "raw_google_ads",
      recordsLastSync: gAds.rowsLoaded > 0
        ? `${gAds.rowsLoaded.toLocaleString("pt-BR")} registos`
        : undefined,
      syncFrequency:   "Diário · 09:00 UTC",
      logo:            <GoogleAdsLogo />,
    },
    {
      id:              "ga4",
      name:            "Google Analytics 4",
      description:     "Sessões, eventos, conversões e comportamento de usuários",
      status:          ga4.status,
      lastSync:        ga4.lastSync ?? undefined,
      bqDataset:       "raw_ga4_sessions",
      recordsLastSync: ga4.rowsLoaded > 0
        ? `${ga4.rowsLoaded.toLocaleString("pt-BR")} registos`
        : undefined,
      syncFrequency:   "Diário · 09:00 UTC",
      logo:            <GA4Logo />,
    },
    ...STATIC_CONNECTORS,
  ], []);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/connectors/status");
      const body = await res.json();
      if (body.ok && body.data) {
        setConnectors(buildConnectors(body.data.google_ads, body.data.ga4));
        setTrackingIssues(body.data.tracking_issues ?? []);
      }
    } catch {
      // keep previous state on network error
    } finally {
      setLoading(false);
    }
  }, [buildConnectors]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const startSync = (id: string) => {
    setSyncingIds((s) => new Set(s).add(id));
    setTimeout(() => {
      setSyncingIds((s) => { const n = new Set(s); n.delete(id); return n; });
      fetchStatus();
    }, 1500);
  };

  const handleGlobalSync = () => {
    const activeIds = connectors
      .filter((c) => c.status === "synced" || c.status === "pending" || c.status === "error")
      .map((c) => c.id);
    setGlobalSyncing(true);
    activeIds.forEach((id) => startSync(id));
    setTimeout(() => setGlobalSyncing(false), 1800);
  };

  const handleConnect    = (id: string) => setConnectors((cs) =>
    cs.map((c) => c.id === id ? { ...c, status: "pending" as ConnectorStatus, lastSync: "Pendente", syncFrequency: "A cada hora" } : c)
  );
  const handleDisconnect = (id: string) => setConnectors((cs) =>
    cs.map((c) => c.id === id ? { ...c, status: "disconnected" as ConnectorStatus, lastSync: undefined } : c)
  );

  const syncedCount       = connectors.filter((c) => c.status === "synced").length;
  const pendingCount      = connectors.filter((c) => c.status === "pending").length;
  const disconnectedCount = connectors.filter((c) => c.status === "disconnected").length;
  const errorCount        = connectors.filter((c) => c.status === "error").length;
  const hasTrackingAlert  = trackingIssues.length > 0;

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-5 border-b border-zinc-800/80 bg-[#09090b]/90 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Cloud size={14} className="text-indigo-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">Conectores de Dados</h1>
              <p className="text-[10px] text-zinc-500">BigQuery · Pipeline Python · GitHub Actions</p>
            </div>
          </div>

          <button
            onClick={handleGlobalSync}
            disabled={globalSyncing || loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-xl text-xs font-semibold text-white transition-colors shadow-lg shadow-indigo-900/30"
          >
            {globalSyncing
              ? <><Loader2 size={13} className="animate-spin" /> Sincronizando...</>
              : <><RefreshCcw size={13} /> Atualizar Status</>
            }
          </button>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-5">
          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Conectados",    value: syncedCount,       icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/15" },
              { label: "Aguardando",    value: pendingCount,      icon: AlertCircle,  color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/15"   },
              { label: "Com Erro",      value: errorCount,        icon: AlertCircle,  color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/15"     },
              { label: "Desconectados", value: disconnectedCount, icon: XCircle,      color: "text-zinc-500",    bg: "bg-zinc-800/40",    border: "border-zinc-800"       },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className={`flex items-center gap-3 bg-[#0d1117] border ${s.border} rounded-xl p-3.5`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg}`}>
                    <Icon size={16} className={s.color} />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-slate-100 leading-none">{s.value}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{s.label}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tracking integrity alert */}
          {hasTrackingAlert && (
            <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
              <ShieldAlert size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-300">Problemas de integridade de tracking detectados</p>
                <p className="text-[11px] text-red-700 mt-0.5">
                  {trackingIssues.map((i) => i.check_name).join(" · ")} — os diagnósticos de IA podem ser afectados.
                </p>
              </div>
            </div>
          )}

          {/* All synced banner */}
          {!hasTrackingAlert && syncedCount === 2 && !loading && (
            <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-4 py-3 mb-4">
              <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">Pipeline operacional · Tracking íntegro</p>
                <p className="text-[11px] text-emerald-700">Google Ads e GA4 sincronizados. Diagnósticos de IA com dados confiáveis.</p>
              </div>
            </div>
          )}

          {/* Section label */}
          <p className="text-[11px] text-zinc-600 uppercase tracking-widest font-semibold mb-3">
            Integrações disponíveis
          </p>

          {/* Loading skeleton */}
          {loading && connectors.length === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-52 bg-[#0d1117] border border-zinc-800/40 rounded-2xl animate-pulse" />
              ))}
            </div>
          )}

          {/* Connectors grid */}
          {connectors.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {connectors.map((connector) => (
                <ConnectorCard
                  key={connector.id}
                  connector={connector}
                  isSyncing={syncingIds.has(connector.id)}
                  onSync={startSync}
                  onConnect={handleConnect}
                  onDisconnect={handleDisconnect}
                />
              ))}

              {/* Em breve */}
              {[
                { name: "HubSpot CRM",  desc: "Contacts, deals, pipeline" },
                { name: "TikTok Ads",   desc: "Campanhas e criativos TikTok" },
              ].map((p) => (
                <div
                  key={p.name}
                  className="flex flex-col items-center justify-center bg-[#0d1117] border border-zinc-800/40 border-dashed rounded-2xl p-6 text-center opacity-40"
                >
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center mb-3">
                    <Database size={18} className="text-zinc-600" />
                  </div>
                  <p className="text-sm font-semibold text-zinc-500">{p.name}</p>
                  <p className="text-[11px] text-zinc-700 mt-0.5 mb-3">{p.desc}</p>
                  <span className="text-[10px] font-semibold text-zinc-600 bg-zinc-800/60 px-2.5 py-1 rounded-full border border-zinc-700/40">
                    Em breve
                  </span>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
