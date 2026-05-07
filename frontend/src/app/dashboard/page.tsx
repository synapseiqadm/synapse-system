"use client";
import { useEffect, useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { createClient } from "@/utils/supabase/client";
import {
  LayoutGrid, Radio, Settings, TrendingUp, TrendingDown,
  DollarSign, Repeat2, Loader2, AlertCircle, CalendarDays,
  Search, Tag, Megaphone, Hash, ChevronRight,
} from "lucide-react";

// ─── Config ───────────────────────────────────────────────────────────────────

const WOKE_WORKSPACE_ID = "a082fe86-a65f-4c9b-9442-fe775f47e3fc";

type Period  = 7 | 15 | 30;
type NavItem = "geral" | "campanhas" | "keywords" | "canais" | "configuracoes";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiRow {
  date: string;
  metric_name: string;
  metric_value: number;
  channel: string;
}

interface CampaignRow {
  campaign_name: string;
  cost: number;
  conversions: number;
  roas: number;
}

interface KeywordRow {
  keyword: string;
  campaign_name: string;
  match_type: string;
  clicks: number;
  cost: number;
  conversions: number;
}

interface ChartPoint {
  date: string;
  total_cost: number;
  roas: number;
}

interface Summary {
  total_cost: number;
  roas: number;
  conversions: number;
  costDelta: number;
  roasDelta: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function pivotToChart(rows: KpiRow[]): ChartPoint[] {
  const map: Record<string, ChartPoint> = {};
  for (const row of rows) {
    if (!map[row.date]) map[row.date] = { date: row.date, total_cost: 0, roas: 0 };
    if (row.metric_name === "total_cost") map[row.date].total_cost = row.metric_value;
    if (row.metric_name === "roas")       map[row.date].roas       = row.metric_value;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function buildSummary(rows: KpiRow[]): Summary {
  const costs  = rows.filter((r) => r.metric_name === "total_cost").map((r) => r.metric_value);
  const roases = rows.filter((r) => r.metric_name === "roas").map((r) => r.metric_value);
  const convs  = rows.filter((r) => r.metric_name === "conversions").map((r) => r.metric_value);

  const total_cost  = costs.reduce((s, v) => s + v, 0);
  const roas        = roases.length ? roases.reduce((s, v) => s + v, 0) / roases.length : 0;
  const conversions = convs.reduce((s, v) => s + v, 0);

  const half  = Math.floor(costs.length / 2);
  const first = costs.slice(0, half).reduce((s, v) => s + v, 0);
  const last  = costs.slice(half).reduce((s, v) => s + v, 0);
  const costDelta = first > 0 ? ((last - first) / first) * 100 : 0;

  const firstR = roases.slice(0, half).reduce((s, v) => s + v, 0) / (half || 1);
  const lastR  = roases.slice(half).reduce((s, v) => s + v, 0) / (roases.length - half || 1);
  const roasDelta = firstR > 0 ? ((lastR - firstR) / firstR) * 100 : 0;

  return { total_cost, roas, conversions, costDelta, roasDelta };
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function DashSidebar({ active, onNavigate }: { active: NavItem; onNavigate: (n: NavItem) => void }) {
  const inCampanhasGroup = active === "campanhas" || active === "keywords";

  function NavBtn({
    id, label, icon: Icon, sub = false,
  }: { id: NavItem; label: string; icon: React.ElementType; sub?: boolean }) {
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

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-[#09090b] border-r border-zinc-800/60">
      {/* Logo */}
      <div className="px-5 h-14 flex items-center border-b border-zinc-800/60">
        <span className="text-sm font-bold text-white tracking-tight">SynapseIQ</span>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {/* Geral */}
        <NavBtn id="geral" label="Geral" icon={LayoutGrid} />

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

          {/* Sub-items — always visible when group is expanded */}
          <div
            className={`overflow-hidden transition-all duration-200
              ${inCampanhasGroup ? "max-h-24 opacity-100 mt-0.5" : "max-h-0 opacity-0"}`}
          >
            <div className="ml-3 pl-3 border-l border-zinc-800/70 space-y-0.5 py-0.5">
              <NavBtn id="campanhas" label="Visão Geral"    icon={Megaphone} sub />
              <NavBtn id="keywords"  label="Palavras-chave" icon={Hash}      sub />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-zinc-800/60 my-1.5 mx-1" />

        {/* Bottom items */}
        <NavBtn id="canais"        label="Canais"        icon={Radio}    />
        <NavBtn id="configuracoes" label="Configurações" icon={Settings} />
      </nav>

      {/* Workspace badge */}
      <div className="p-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-xs font-bold text-white">
            W
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-200">Woke</p>
            <p className="text-[10px] text-zinc-600">workspace</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Shared small components ──────────────────────────────────────────────────

interface MetricProps {
  label: string; value: string; delta: number;
  icon: React.ElementType; loading: boolean;
}

function MetricCard({ label, value, delta, icon: Icon, loading }: MetricProps) {
  const up = delta >= 0;
  return (
    <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
        <div className="w-7 h-7 rounded-lg bg-indigo-600/10 border border-indigo-500/15 flex items-center justify-center">
          <Icon size={13} className="text-indigo-400" />
        </div>
      </div>
      {loading ? (
        <div className="h-8 flex items-center">
          <Loader2 size={18} className="animate-spin text-zinc-700" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold text-white mb-1">{value}</p>
          <div className={`flex items-center gap-1 text-[11px] font-medium ${up ? "text-emerald-400" : "text-red-400"}`}>
            {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {up ? "+" : ""}{delta.toFixed(1)}% vs. período anterior
          </div>
        </>
      )}
    </div>
  );
}

function roasBadge(roas: number) {
  if (roas >= 3.0) return { label: `${roas.toFixed(2)}x`, color: "#10b981", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  if (roas >= 1.5) return { label: `${roas.toFixed(2)}x`, color: "#f59e0b", className: "bg-amber-500/15  text-amber-400  border-amber-500/30"  };
  return               { label: `${roas.toFixed(2)}x`, color: "#ef4444", className: "bg-red-500/15    text-red-400    border-red-500/30"    };
}

const MATCH_TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  BROAD:  { label: "Broad",  className: "bg-sky-500/15    text-sky-400    border-sky-500/30"    },
  PHRASE: { label: "Phrase", className: "bg-amber-500/15  text-amber-400  border-amber-500/30"  },
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

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 shadow-xl text-xs">
      <p className="text-zinc-400 mb-2 font-mono">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-zinc-300 capitalize">{p.name}:</span>
          <span className="font-semibold text-white">
            {p.name === "total_cost" ? formatBRL(p.value) : p.value.toFixed(2) + "x"}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── View: Geral ──────────────────────────────────────────────────────────────

function GeralView({
  loading, error, chart, summary, period, setPeriod,
}: {
  loading: boolean;
  error: string | null;
  chart: ChartPoint[];
  summary: Summary;
  period: Period;
  setPeriod: (p: Period) => void;
}) {
  const PERIODS: Period[] = [7, 15, 30];

  return (
    <>
      {/* Period selector */}
      <div className="flex items-center justify-end mb-6">
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          <CalendarDays size={13} className="text-zinc-600 ml-1.5" />
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                ${period === p ? "bg-indigo-600 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-200"}`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5 text-sm text-red-400">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>Erro ao carregar dados: <span className="font-mono text-xs">{error}</span></span>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <MetricCard label="Investimento Total" value={loading ? "—" : formatBRL(summary.total_cost)} delta={summary.costDelta} icon={DollarSign} loading={loading} />
        <MetricCard label="Conversões"         value={loading ? "—" : summary.conversions.toFixed(0)} delta={0}              icon={Repeat2}    loading={loading} />
        <MetricCard label="ROAS Médio"         value={loading ? "—" : summary.roas.toFixed(2) + "x"}  delta={summary.roasDelta} icon={TrendingUp} loading={loading} />
      </div>

      {/* Chart */}
      <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-sm font-semibold text-white">Performance · Custo vs. ROAS</p>
            <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">últimos {period} dias · Google Ads</p>
          </div>
          {loading && <Loader2 size={15} className="animate-spin text-zinc-600" />}
        </div>

        {!loading && chart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-700">
            <p className="text-sm">Sem dados para o período selecionado.</p>
            <p className="text-xs mt-1">Verifique o WOKE_WORKSPACE_ID e execute o script de sync.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chart} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fill: "#71717a", fontSize: 11, fontFamily: "monospace" }} axisLine={{ stroke: "#27272a" }} tickLine={false} />
              <YAxis yAxisId="cost" orientation="left"  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
              <YAxis yAxisId="roas" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}x`}             tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: "#71717a", paddingTop: 16 }} formatter={(v) => v === "total_cost" ? "Custo" : "ROAS"} />
              <Line yAxisId="cost" type="monotone" dataKey="total_cost" stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              <Line yAxisId="roas" type="monotone" dataKey="roas"       stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
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

      <div className="flex items-end justify-between mb-4">
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
      {/* Summary strip */}
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

      {/* Cards grid */}
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
                <CampaignCard key={c.campaign_name} campaign={c} totalCost={totalCost} />
              ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── View: Palavras-chave ─────────────────────────────────────────────────────

function KeywordsView({ keywords, loading }: { keywords: KeywordRow[]; loading: boolean }) {
  const [search, setSearch] = useState("");
  const [matchFilter, setMatchFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = keywords;
    if (matchFilter !== "all") list = list.filter((k) => k.match_type?.toUpperCase() === matchFilter);
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((k) => k.keyword.toLowerCase().includes(q) || k.campaign_name.toLowerCase().includes(q));
    return list;
  }, [keywords, search, matchFilter]);

  const totalCost = filtered.reduce((s, k) => s + k.cost, 0);
  const totalConv = filtered.reduce((s, k) => s + k.conversions, 0);
  const totalClicks = filtered.reduce((s, k) => s + k.clicks, 0);

  const MATCH_OPTIONS = [
    { value: "all",    label: "Todos" },
    { value: "BROAD",  label: "Broad"  },
    { value: "PHRASE", label: "Phrase" },
    { value: "EXACT",  label: "Exact"  },
  ];

  return (
    <>
      {/* Summary strip */}
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

      {/* Table card */}
      <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-zinc-800/60">
          {/* Search */}
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

          {/* Match type filter */}
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

        {/* Table */}
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

        {/* Footer */}
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
  geral:         { title: "Visão Geral",     subtitle: "Google Ads · kpi_cache_daily"                 },
  campanhas:     { title: "Campanhas",        subtitle: "campaign_summary · últimos 30 dias"           },
  keywords:      { title: "Palavras-chave",  subtitle: "keyword_analysis · últimos 30 dias"           },
  canais:        { title: "Canais",           subtitle: "Integrações e conectores ativos"              },
  configuracoes: { title: "Configurações",    subtitle: "Preferências do workspace"                    },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const supabase = createClient();

  const [nav, setNav]         = useState<NavItem>("geral");
  const [period, setPeriod]   = useState<Period>(7);
  const [rows, setRows]       = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [campaigns, setCampaigns]               = useState<CampaignRow[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const [keywords, setKeywords]               = useState<KeywordRow[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true); setError(null);
      const { data, error: sbError } = await supabase
        .from("kpi_cache_daily")
        .select("date, metric_name, metric_value, channel")
        .eq("workspace_id", WOKE_WORKSPACE_ID)
        .gte("date", sinceDate(period))
        .order("date", { ascending: true });
      if (sbError) { setError(sbError.message); setLoading(false); return; }
      setRows((data as KpiRow[]) ?? []);
      setLoading(false);
    }
    fetchData();
  }, [period]);

  useEffect(() => {
    async function fetchCampaigns() {
      setCampaignsLoading(true);
      const { data } = await supabase
        .from("campaign_summary")
        .select("campaign_name, cost, conversions, roas")
        .eq("workspace_id", WOKE_WORKSPACE_ID)
        .order("cost", { ascending: false });
      setCampaigns((data as CampaignRow[]) ?? []);
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
        .eq("workspace_id", WOKE_WORKSPACE_ID)
        .order("conversions", { ascending: false });
      setKeywords((data as KeywordRow[]) ?? []);
      setKeywordsLoading(false);
    }
    fetchKeywords();
  }, []);

  const chart   = useMemo(() => pivotToChart(rows), [rows]);
  const summary = useMemo(() => buildSummary(rows), [rows]);
  const meta    = NAV_META[nav];

  function handleNavigate(n: NavItem) {
    setNav(n);
    // Opening parent "Campanhas" defaults to campaigns view
  }

  return (
    <div className="flex h-screen bg-[#09090b] text-slate-200 overflow-hidden font-sans">
      <DashSidebar active={nav} onNavigate={handleNavigate} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 flex items-center px-6 border-b border-zinc-800/60 flex-shrink-0">
          <div>
            <h1 className="text-sm font-bold text-white">{meta.title}</h1>
            <p className="text-[10px] text-zinc-600 font-mono">{meta.subtitle}</p>
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-6">
          {nav === "geral" && (
            <GeralView
              loading={loading}
              error={error}
              chart={chart}
              summary={summary}
              period={period}
              setPeriod={setPeriod}
            />
          )}

          {nav === "campanhas" && (
            <CampanhasView campaigns={campaigns} loading={campaignsLoading} />
          )}

          {nav === "keywords" && (
            <KeywordsView keywords={keywords} loading={keywordsLoading} />
          )}

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
