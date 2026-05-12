"use client";
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";
import {
  LayoutGrid, Radio, Settings,
  Loader2, Search, Tag, Megaphone, Hash, ChevronRight,
  ShieldCheck, Lightbulb, Building2, Activity, Database, LogOut,
} from "lucide-react";
import { GrowthIntelligenceView } from "@/components/GrowthIntelligenceView";
import { DataQualityView }        from "@/components/DataQualityView";
import { InsightsView }           from "@/components/InsightsView";
import { ExecutiveBoardView }     from "@/components/ExecutiveBoardView";
import { AINarrativeCard }        from "@/components/AINarrativeCard";
import { DEFAULT_WORKSPACE }      from "@/lib/workspace";

// ─── Config ───────────────────────────────────────────────────────────────────

type NavItem =
  | "geral" | "growth" | "campanhas" | "keywords"
  | "qualidade" | "insights" | "canais" | "configuracoes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CampaignRow {
  campaign_id:      string;
  campaign_name:    string;
  cost:             number;
  conversions:      number;
  roas:             number;
  clicks:           number;
  ctr:              number;
  date_range_start: string;
  date_range_end:   string;
}

interface KeywordRow {
  keyword:       string;
  campaign_name: string;
  match_type:    string;
  clicks:        number;
  cost:          number;
  conversions:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface NavBtnProps {
  id: NavItem;
  label: string;
  icon: React.ElementType;
  sub?: boolean;
  active: NavItem;
  onNavigate: (n: NavItem) => void;
}

function NavBtn({ id, label, icon: Icon, sub = false, active, onNavigate }: NavBtnProps) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onNavigate(id)}
      className={`w-full flex items-center gap-2.5 rounded-lg text-sm transition-colors
        ${sub ? "px-2.5 py-1.5" : "px-3 py-2"}
        ${isActive
          ? "bg-indigo-600/15 text-indigo-300 font-medium"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
        }`}
    >
      <Icon size={sub ? 13 : 15} />
      {label}
    </button>
  );
}

function DashSidebar({
  active,
  onNavigate,
  userEmail,
}: {
  active: NavItem;
  onNavigate: (n: NavItem) => void;
  userEmail: string;
}) {
  const inCampanhasGroup = active === "campanhas" || active === "keywords";

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-[#09090b] border-r border-zinc-800/60">
      {/* Logo */}
      <div className="px-5 h-14 flex items-center border-b border-zinc-800/60">
        <span className="text-sm font-bold text-white tracking-tight">SynapseIQ</span>
      </div>

      {/* Active tenant */}
      <div className="px-5 py-2.5 border-b border-zinc-800/60 bg-zinc-900/40">
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Cliente</p>
        <div className="flex items-center gap-1.5">
          <Building2 size={11} className="text-indigo-400 flex-shrink-0" />
          <p className="text-xs font-semibold text-zinc-300 truncate">{DEFAULT_WORKSPACE.name}</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        <NavBtn id="geral"  label="Painel Executivo"  icon={LayoutGrid} active={active} onNavigate={onNavigate} />
        <NavBtn id="growth" label="Growth Intelligence" icon={Activity}   active={active} onNavigate={onNavigate} />

        {/* Campanhas group */}
        <div>
          <button
            onClick={() => onNavigate("campanhas")}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors
              ${inCampanhasGroup
                ? "text-zinc-200"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
          >
            <span className="flex items-center gap-2.5">
              <Megaphone size={15} />
              Campanhas
            </span>
            <ChevronRight
              size={13}
              className={`transition-transform duration-200 text-zinc-600
                ${inCampanhasGroup ? "rotate-90" : ""}`}
            />
          </button>

          <div
            className={`overflow-hidden transition-all duration-200
              ${inCampanhasGroup ? "max-h-24 opacity-100 mt-0.5" : "max-h-0 opacity-0"}`}
          >
            <div className="ml-3 pl-3 border-l border-zinc-800/70 space-y-0.5 py-0.5">
              <NavBtn id="campanhas" label="Visão Geral"    icon={Megaphone} sub active={active} onNavigate={onNavigate} />
              <NavBtn id="keywords"  label="Palavras-chave" icon={Hash}      sub active={active} onNavigate={onNavigate} />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-zinc-800/60 my-1.5 mx-1" />

        <NavBtn id="qualidade"     label="Qualidade"     icon={ShieldCheck} active={active} onNavigate={onNavigate} />
        <NavBtn id="insights"      label="Insights"      icon={Lightbulb}   active={active} onNavigate={onNavigate} />
        <Link
          href="/logs"
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
        >
          <Database size={15} />
          Status do Sync
        </Link>
        <NavBtn id="canais"        label="Canais"        icon={Radio}       active={active} onNavigate={onNavigate} />
        <NavBtn id="configuracoes" label="Configurações" icon={Settings}    active={active} onNavigate={onNavigate} />
      </nav>

      {/* User + logout */}
      <div className="p-3 border-t border-zinc-800/60 space-y-1">
        <div className="flex items-center gap-2 px-1">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {(userEmail[0] ?? "?").toUpperCase()}
          </div>
          <p className="text-[10px] text-zinc-400 truncate flex-1 min-w-0">{userEmail || "…"}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-zinc-600 hover:text-red-400 hover:bg-red-500/5 transition-colors"
        >
          <LogOut size={11} />
          Sair
        </button>
      </div>
    </aside>
  );
}

// ─── Shared small components ──────────────────────────────────────────────────

function roasBadge(roas: number) {
  if (roas >= 3.0) return { label: `${roas.toFixed(2)}x`, color: "#10b981", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (roas >= 1.5) return { label: `${roas.toFixed(2)}x`, color: "#f59e0b", className: "bg-amber-500/15  text-amber-400  border-amber-500/30"  };
  return               { label: `${roas.toFixed(2)}x`, color: "#ef4444", className: "bg-red-500/15    text-red-400    border-red-500/30"    };
}

const MATCH_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  BROAD:  { label: "Broad",  className: "bg-sky-500/15     text-sky-400     border-sky-500/30"     },
  PHRASE: { label: "Phrase", className: "bg-amber-500/15   text-amber-400   border-amber-500/30"   },
  EXACT:  { label: "Exact",  className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
};

function MatchTypeBadge({ type }: { type: string }) {
  const cfg = MATCH_TYPE_CONFIG[type?.toUpperCase()] ?? {
    label: type ?? "?",
    className: "bg-zinc-700/40 text-zinc-400 border-zinc-600/40",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}>
      <Tag size={9} />
      {cfg.label}
    </span>
  );
}

// ─── View: Campanhas ──────────────────────────────────────────────────────────

function CampaignCard({ campaign, totalCost }: { campaign: CampaignRow; totalCost: number }) {
  const badge        = roasBadge(campaign.roas);
  const shareOfSpend = totalCost > 0 ? (campaign.cost / totalCost) * 100 : 0;

  return (
    <div className="
      group relative overflow-hidden rounded-xl p-4
      bg-white/[0.03] backdrop-blur-sm border border-white/[0.07]
      hover:bg-white/[0.06] hover:border-white/[0.12]
      transition-all duration-200 cursor-default
    ">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-sm font-semibold text-zinc-100 leading-tight line-clamp-2">{campaign.campaign_name}</p>
        <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Custo</p>
          <p className="text-base font-bold text-white font-mono">
            {campaign.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Conversões</p>
          <p className="text-base font-bold text-zinc-300 font-mono">{campaign.conversions}</p>
        </div>
      </div>

      {/* Funnel efficiency row — CTR + CPC */}
      <div className="flex items-center justify-between mb-3 pt-2 border-t border-zinc-800/30">
        <div>
          <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">CTR</p>
          <p className="text-xs font-semibold text-zinc-400 font-mono">
            {campaign.clicks > 0
              ? (campaign.ctr * 100).toFixed(2).replace(".", ",") + "%"
              : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-0.5">CPC</p>
          <p className="text-xs font-semibold text-zinc-400 font-mono">
            {campaign.clicks > 0
              ? (campaign.cost / campaign.clicks).toLocaleString("pt-BR", {
                  style: "currency", currency: "BRL",
                })
              : "—"}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[9px] text-zinc-700 uppercase tracking-wider">Share of Spend</p>
          <p className="text-[9px] font-mono text-zinc-600">{shareOfSpend.toFixed(1)}%</p>
        </div>
        <div className="h-1 w-full bg-white/[0.05] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${shareOfSpend}%`, backgroundColor: badge.color, opacity: 0.7 }} />
        </div>
      </div>
    </div>
  );
}

function CampanhasView({ campaigns, loading }: { campaigns: CampaignRow[]; loading: boolean }) {
  const totalCost = campaigns.reduce((s, c) => s + c.cost, 0);

  return (
    <>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">Total Investido</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white font-mono">{formatBRL(totalCost)}</p>
          )}
        </div>
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">Campanhas Ativas</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white">{campaigns.length}</p>
          )}
        </div>
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">ROAS Médio</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white">
              {campaigns.length
                ? (campaigns.reduce((s, c) => s + c.roas, 0) / campaigns.length).toFixed(2) + "x"
                : "—"}
            </p>
          )}
        </div>
      </div>

      <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-white">Campanhas</p>
            <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">campaign_summary · últimos 30 dias · ordenado por custo</p>
          </div>
          {loading && <Loader2 size={14} className="animate-spin text-zinc-600" />}
        </div>

        {!loading && campaigns.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-zinc-700 text-sm">
            Sem campanhas. Execute <span className="font-mono mx-1">sync_woke.py</span> primeiro.
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {[...campaigns]
              .sort((a, b) => b.cost - a.cost)
              .map((c) => (
                <CampaignCard key={`${c.campaign_id}-${c.date_range_start}`} campaign={c} totalCost={totalCost} />
              ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── View: Palavras-chave ─────────────────────────────────────────────────────

function KeywordsView({ keywords, loading }: { keywords: KeywordRow[]; loading: boolean }) {
  const [search, setSearch]           = useState("");
  const [matchFilter, setMatchFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = keywords;
    if (matchFilter !== "all") list = list.filter((k) => k.match_type?.toUpperCase() === matchFilter);
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((k) => k.keyword.toLowerCase().includes(q) || k.campaign_name.toLowerCase().includes(q));
    return list;
  }, [keywords, search, matchFilter]);

  const totalCost   = filtered.reduce((s, k) => s + k.cost, 0);
  const totalConv   = filtered.reduce((s, k) => s + k.conversions, 0);
  const totalClicks = filtered.reduce((s, k) => s + k.clicks, 0);

  const MATCH_OPTIONS = [
    { value: "all",    label: "Todos"  },
    { value: "BROAD",  label: "Broad"  },
    { value: "PHRASE", label: "Phrase" },
    { value: "EXACT",  label: "Exact"  },
  ];

  return (
    <>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">Custo Total</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white font-mono">{formatBRL(totalCost)}</p>
          )}
        </div>
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">Cliques Totais</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white">{totalClicks.toLocaleString("pt-BR")}</p>
          )}
        </div>
        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <p className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-2">Conversões</p>
          {loading ? <Loader2 size={18} className="animate-spin text-zinc-700" /> : (
            <p className="text-2xl font-bold text-white">{totalConv}</p>
          )}
        </div>
      </div>

      <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800/60">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar keyword ou campanha..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-indigo-500/60 rounded-xl pl-8 pr-4 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 text-xs">
                ✕
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            {MATCH_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setMatchFilter(value)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                  ${matchFilter === value ? "bg-indigo-600 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-200"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && <Loader2 size={14} className="animate-spin text-zinc-600" />}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={22} className="animate-spin text-zinc-700" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-28 text-zinc-700 text-sm">
            {search || matchFilter !== "all"
              ? "Nenhuma keyword encontrada para esses filtros."
              : "Sem dados. Execute sync_woke.py primeiro."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800/60">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider w-[28%]">Keyword</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Tipo</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Campanha</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Cliques</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Custo</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Conv.</th>
                  <th className="text-right px-4 py-3 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">CPA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40">
                {filtered.map((kw, i) => {
                  const cpa = kw.conversions > 0 ? kw.cost / kw.conversions : null;
                  return (
                    <tr key={`${kw.keyword}-${kw.campaign_name}-${i}`} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-zinc-100 font-medium">{kw.keyword}</td>
                      <td className="px-4 py-3"><MatchTypeBadge type={kw.match_type} /></td>
                      <td className="px-4 py-3 text-zinc-500 max-w-[180px] truncate" title={kw.campaign_name}>
                        {kw.campaign_name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">{kw.clicks.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right font-mono text-zinc-300">
                        {kw.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className={kw.conversions > 0 ? "text-emerald-400 font-semibold" : "text-zinc-600"}>
                          {kw.conversions}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {cpa !== null
                          ? <span className="text-zinc-300">{cpa.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span>
                          : <span className="text-zinc-700">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="border-t border-zinc-800/40 px-4 py-2.5 flex items-center justify-between">
            <p className="text-[10px] text-zinc-700 font-mono">{filtered.length} de {keywords.length} keywords</p>
            <p className="text-[10px] text-zinc-700 font-mono">
              Total filtrado: {totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Header config per nav ────────────────────────────────────────────────────

const NAV_META: Record<NavItem, { title: string; subtitle: string }> = {
  geral:         { title: "Painel Executivo",    subtitle: "síntese operacional · determinístico"             },
  growth:        { title: "Growth Intelligence", subtitle: "GA4 · Funil · Governança · Woke People"          },
  campanhas:     { title: "Campanhas",           subtitle: "campaign_summary · últimos 30 dias"               },
  keywords:      { title: "Palavras-chave",      subtitle: "keyword_analysis · últimos 30 dias"               },
  qualidade:     { title: "Qualidade dos Dados", subtitle: "data_quality_report · A-Data checks"              },
  insights:      { title: "Insights",            subtitle: "insight_feed · A-Insights v1 determinístico"      },
  canais:        { title: "Canais",              subtitle: "Integrações e conectores ativos"                  },
  configuracoes: { title: "Configurações",       subtitle: "Preferências do workspace"                        },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient();

  const [nav, setNav]           = useState<NavItem>("geral");
  const [userEmail, setUserEmail] = useState("");

  const [campaigns, setCampaigns]               = useState<CampaignRow[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const [keywords, setKeywords]               = useState<KeywordRow[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email);
    });
  }, []);

  useEffect(() => {
    async function fetchCampaigns() {
      setCampaignsLoading(true);
      const { data } = await supabase
        .from("campaign_summary")
        .select("campaign_id, campaign_name, cost, conversions, roas, clicks, ctr, date_range_start, date_range_end")
        .eq("workspace_id", DEFAULT_WORKSPACE.id)
        .eq("is_mock", false)
        .order("date_range_end", { ascending: false })
        .order("cost",           { ascending: false });
      // Keep only the most recent snapshot per campaign.
      const seen = new Set<string>();
      const deduped = ((data as CampaignRow[]) ?? []).filter(row => {
        if (seen.has(row.campaign_id)) return false;
        seen.add(row.campaign_id);
        return true;
      });
      setCampaigns(deduped);
      setCampaignsLoading(false);
    }
    fetchCampaigns();
  }, []);

  useEffect(() => {
    async function fetchKeywords() {
      setKeywordsLoading(true);
      const { data } = await supabase
        .from("keyword_analysis")
        .select("keyword, campaign_name, match_type, clicks, cost, conversions")
        .eq("workspace_id", DEFAULT_WORKSPACE.id)
        .order("conversions", { ascending: false });
      setKeywords((data as KeywordRow[]) ?? []);
      setKeywordsLoading(false);
    }
    fetchKeywords();
  }, []);

  const meta = NAV_META[nav];

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <DashSidebar active={nav} onNavigate={setNav} userEmail={userEmail} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-800/60 flex-shrink-0">
          <div>
            <h1 className="text-sm font-bold text-white">{meta.title}</h1>
            <p className="text-[10px] text-zinc-600 font-mono">{meta.subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-2.5 py-1">
              <Building2 size={11} className="text-indigo-400" />
              <span className="text-[11px] font-medium text-indigo-300">{DEFAULT_WORKSPACE.name}</span>
            </div>
            {userEmail && (
              <span className="text-[10px] text-zinc-600 font-mono hidden sm:block truncate max-w-[180px]">
                {userEmail}
              </span>
            )}
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-6">
          {nav === "geral"      && <ExecutiveBoardView />}
          {nav === "growth"     && <GrowthIntelligenceView />}
          {nav === "campanhas"  && <CampanhasView campaigns={campaigns} loading={campaignsLoading} />}
          {nav === "keywords"   && <KeywordsView  keywords={keywords}   loading={keywordsLoading} />}
          {nav === "qualidade"  && <DataQualityView />}
          {nav === "insights"   && <InsightsView />}

          {(nav === "canais" || nav === "configuracoes") && (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-700">
              <p className="text-sm">{meta.title}</p>
              <p className="text-xs mt-1 font-mono">Em construção</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
