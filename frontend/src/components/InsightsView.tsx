"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  Loader2, AlertCircle, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Clock, Lightbulb, Search,
  Database, RefreshCw, Building2,
} from "lucide-react";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";

// ─── Types ────────────────────────────────────────────────────────────────────

type InsightSeverity = "low" | "medium" | "high" | "critical";
type InsightStatus   = "new" | "reviewed" | "dismissed" | "resolved";

interface InsightFeedItem {
  id: string;
  workspace_id: string;
  insight_type: string;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  summary: string;
  recommendation?: string | null;
  evidence?: Record<string, unknown> | null;
  source_tables?: string[] | null;
  confidence?: number | null;
  dedupe_key?: string | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_ORDER: Record<InsightSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  campaign_zero_conversions_with_cost: "Campanha Sem Conversão",
  keyword_zero_conversions_with_cost:  "Keyword Sem Conversão",
  data_quality_warning_context:        "Atenção na Qualidade dos Dados",
  ga4_not_configured:                  "GA4 Não Configurado",
  data_quality_blocker:                "Bloqueio por Qualidade",
};

function insightTypeLabel(type: string): string {
  return (
    INSIGHT_TYPE_LABELS[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatDateOnly(iso: string): string {
  // date-only strings like "2026-04-08" — parse without timezone shift
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function evidenceSearchText(ins: InsightFeedItem): string {
  if (!ins.evidence) return "";
  const ev = ins.evidence;
  return [ev.keyword, ev.campaign_name, ev.campaign_id].filter(Boolean).join(" ").toLowerCase();
}

// ─── Status actions ───────────────────────────────────────────────────────────

const STATUS_ACTIONS: Record<InsightStatus, { label: string; to: InsightStatus; cls: string }[]> = {
  new: [
    { label: "Revisar",   to: "reviewed",  cls: "border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10" },
    { label: "Resolver",  to: "resolved",  cls: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
    { label: "Descartar", to: "dismissed", cls: "border-zinc-700 text-zinc-500 hover:bg-zinc-800/60" },
  ],
  reviewed: [
    { label: "Resolver",  to: "resolved",  cls: "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10" },
    { label: "Descartar", to: "dismissed", cls: "border-zinc-700 text-zinc-500 hover:bg-zinc-800/60" },
    { label: "Reabrir",   to: "new",       cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  ],
  resolved: [
    { label: "Descartar", to: "dismissed", cls: "border-zinc-700 text-zinc-500 hover:bg-zinc-800/60" },
    { label: "Reabrir",   to: "new",       cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  ],
  dismissed: [
    { label: "Reabrir",   to: "new",       cls: "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" },
  ],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const cfg = {
    critical: { label: "Crítico", cls: "bg-red-500/20    text-red-400    border-red-500/40"    },
    high:     { label: "Alto",    cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    medium:   { label: "Médio",   cls: "bg-amber-500/15  text-amber-400  border-amber-500/30"  },
    low:      { label: "Baixo",   cls: "bg-zinc-700/40   text-zinc-400   border-zinc-600/40"   },
  }[severity];
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: InsightStatus }) {
  const cfg = {
    new:       { label: "Novo",      cls: "bg-blue-500/15   text-blue-400   border-blue-500/30",    Icon: AlertCircle  },
    reviewed:  { label: "Revisado",  cls: "bg-violet-500/15 text-violet-400 border-violet-500/30",  Icon: RefreshCw    },
    resolved:  { label: "Resolvido", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
    dismissed: { label: "Descartado",cls: "bg-zinc-700/40   text-zinc-500   border-zinc-600/40",    Icon: XCircle      },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <cfg.Icon size={9} />
      {cfg.label}
    </span>
  );
}

function InsightEvidence({
  insight_type,
  evidence,
}: {
  insight_type: string;
  evidence: Record<string, unknown> | null | undefined;
}) {
  if (!evidence) return <p className="text-xs text-zinc-600 italic">Sem evidence registrado.</p>;

  // Campaign zero conversions
  if (insight_type === "campaign_zero_conversions_with_cost") {
    return (
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
        <Row label="Campanha"    value={String(evidence.campaign_name ?? "—")} />
        <Row label="ID"          value={String(evidence.campaign_id ?? "—")} mono />
        <Row label="Custo"       value={typeof evidence.cost === "number" ? formatBRL(evidence.cost) : "—"} />
        <Row label="Conversões"  value={String(evidence.conversions ?? "0")} />
        <Row label="ROAS"        value={typeof evidence.roas === "number" ? `${evidence.roas.toFixed(2)}x` : "—"} />
      </dl>
    );
  }

  // Keyword zero conversions
  if (insight_type === "keyword_zero_conversions_with_cost") {
    return (
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
        <Row label="Keyword"     value={String(evidence.keyword ?? "—")} />
        <Row label="Campanha"    value={String(evidence.campaign_name ?? "—")} />
        <Row label="Match type"  value={String(evidence.match_type ?? "—")} />
        <Row label="Custo"       value={typeof evidence.cost === "number" ? formatBRL(evidence.cost) : "—"} />
        <Row label="Conversões"  value={String(evidence.conversions ?? "0")} />
      </dl>
    );
  }

  // DQ warning context
  if (insight_type === "data_quality_warning_context" || insight_type === "data_quality_blocker") {
    const checks = Array.isArray(evidence.affected_checks) ? evidence.affected_checks as string[] : [];
    const critChecks = Array.isArray(evidence.critical_checks) ? evidence.critical_checks as string[] : [];
    return (
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
        {evidence.warning_count  !== undefined && <Row label="Warnings"  value={String(evidence.warning_count)} />}
        {evidence.failed_count   !== undefined && <Row label="Falhas"    value={String(evidence.failed_count)} />}
        {evidence.critical_count !== undefined && <Row label="Críticos"  value={String(evidence.critical_count)} />}
        {evidence.latest_checked_at !== undefined && (
          <Row label="Verificado" value={formatDateShort(String(evidence.latest_checked_at))} />
        )}
        {checks.length > 0 && (
          <div className="col-span-2 mt-1">
            <p className="text-zinc-600 mb-1">Checks afetados:</p>
            <ul className="space-y-0.5">
              {checks.map((c) => (
                <li key={c} className="font-mono text-zinc-400">{c}</li>
              ))}
            </ul>
          </div>
        )}
        {critChecks.length > 0 && (
          <div className="col-span-2 mt-1">
            <p className="text-zinc-600 mb-1">Checks críticos:</p>
            <ul className="space-y-0.5">
              {critChecks.map((c) => (
                <li key={c} className="font-mono text-red-400">{c}</li>
              ))}
            </ul>
          </div>
        )}
      </dl>
    );
  }

  // GA4 not configured
  if (insight_type === "ga4_not_configured") {
    return (
      <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
        <Row label="GA4 Dataset" value={String(evidence.ga4_dataset || "não configurado")} />
      </dl>
    );
  }

  // Generic fallback: key-value table
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
      {Object.entries(evidence).map(([k, v]) => (
        <Row key={k} label={k.replace(/_/g, " ")} value={String(v ?? "—")} mono />
      ))}
    </dl>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-zinc-600 shrink-0 capitalize">{label}:</dt>
      <dd className={`text-zinc-300 truncate ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

// ─── InsightCard ──────────────────────────────────────────────────────────────

interface InsightCardProps {
  insight: InsightFeedItem;
  updatingKey: string | null;
  updateError: Record<string, string>;
  onStatusChange: (id: string, to: InsightStatus) => void;
}

function InsightCard({ insight, updatingKey, updateError, onStatusChange }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const actions = STATUS_ACTIONS[insight.status] ?? [];

  const severityLeft = {
    critical: "border-l-red-500",
    high:     "border-l-orange-500",
    medium:   "border-l-amber-500/70",
    low:      "border-l-zinc-700",
  }[insight.severity];

  const cardErr = updateError[insight.id];

  return (
    <div className={`bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden border-l-2 ${severityLeft}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            {insightTypeLabel(insight.insight_type)}
          </span>
          <SeverityBadge severity={insight.severity} />
          <StatusBadge status={insight.status} />
          {insight.confidence != null && (
            <span className="text-[10px] text-zinc-600 font-mono">
              {formatConfidence(insight.confidence)} confiança
            </span>
          )}
        </div>
        {insight.updated_at && (
          <span className="text-[10px] text-zinc-700 font-mono whitespace-nowrap shrink-0">
            {formatDateShort(insight.updated_at)}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        <p className="text-sm font-semibold text-zinc-100 mb-1.5 leading-snug">{insight.title}</p>
        <p className="text-xs text-zinc-400 leading-relaxed mb-2">{insight.summary}</p>
        {insight.recommendation && (
          <div className="flex gap-2 bg-zinc-900/60 border border-zinc-800/40 rounded-lg px-3 py-2">
            <Lightbulb size={12} className="text-amber-500/70 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-400 leading-relaxed">{insight.recommendation}</p>
          </div>
        )}
      </div>

      {/* Period */}
      {insight.date_range_start && (
        <div className="px-4 pb-2">
          <p className="text-[10px] text-zinc-700 font-mono">
            Período: {formatDateOnly(insight.date_range_start)} → {formatDateOnly(insight.date_range_end ?? "")}
          </p>
        </div>
      )}

      {/* Error */}
      {cardErr && (
        <div className="mx-4 mb-2 flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5">
          <AlertCircle size={11} />
          {cardErr}
        </div>
      )}

      {/* Footer: actions + expand */}
      <div className="flex items-center justify-between gap-2 px-4 pb-4 border-t border-zinc-800/40 pt-2.5 flex-wrap gap-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {actions.map((action) => {
            const key = `${insight.id}:${action.to}`;
            const isLoading = updatingKey === key;
            return (
              <button
                key={action.to}
                onClick={() => onStatusChange(insight.id, action.to)}
                disabled={updatingKey !== null}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all
                  ${action.cls}
                  ${updatingKey !== null ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {isLoading ? <Loader2 size={10} className="animate-spin" /> : null}
                {action.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Fechar" : "Evidência"}
        </button>
      </div>

      {/* Accordion */}
      {expanded && (
        <div className="border-t border-zinc-800/40 bg-white/[0.015] px-4 py-3 space-y-3">
          <InsightEvidence
            insight_type={insight.insight_type}
            evidence={insight.evidence}
          />
          {/* Metadata footer */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t border-zinc-800/30 text-[10px] text-zinc-700">
            {insight.source_tables && insight.source_tables.length > 0 && (
              <span>Fontes: <span className="font-mono text-zinc-600">{insight.source_tables.join(", ")}</span></span>
            )}
            {insight.dedupe_key && (
              <span>Key: <span className="font-mono text-zinc-600">{insight.dedupe_key}</span></span>
            )}
            <span>Criado: <span className="font-mono text-zinc-600">{formatDateShort(insight.created_at)}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter / sort types ──────────────────────────────────────────────────────

type StatusFilter = "all" | "new" | "reviewed" | "resolved" | "dismissed";
type TypeFilter   = "all" | "high_priority" | "campaigns" | "keywords" | "quality";

// ─── Main view ────────────────────────────────────────────────────────────────

export function InsightsView() {
  const supabase = createClient();

  const [insights, setInsights]     = useState<InsightFeedItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>("all");
  const [search, setSearch]             = useState("");
  const [updatingKey, setUpdatingKey]   = useState<string | null>(null);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      const { data, error: sbError } = await supabase
        .from("insight_feed")
        .select("*")
        .eq("workspace_id", DEFAULT_WORKSPACE.id)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (sbError) { setError(sbError.message); setLoading(false); return; }
      setInsights((data as InsightFeedItem[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const updateStatus = useCallback(async (id: string, to: InsightStatus) => {
    const key = `${id}:${to}`;
    setUpdatingKey(key);
    setUpdateErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });

    const now = new Date().toISOString();
    const { error: sbError } = await supabase
      .from("insight_feed")
      .update({ status: to, updated_at: now })
      .eq("id", id);

    if (sbError) {
      setUpdateErrors((prev) => ({ ...prev, [id]: sbError.message }));
      setUpdatingKey(null);
      return;
    }

    setInsights((prev) =>
      prev.map((ins) => ins.id === id ? { ...ins, status: to, updated_at: now } : ins)
    );
    setUpdatingKey(null);
  }, [supabase]);

  // Derived summary stats
  const totalCount    = insights.length;
  const newCount      = insights.filter((i) => i.status === "new").length;
  const highCount     = insights.filter((i) => i.severity === "high" || i.severity === "critical").length;
  const treatedCount  = insights.filter((i) => i.status === "reviewed" || i.status === "resolved").length;
  const lastUpdated   = insights.length > 0 ? insights[0].updated_at ?? insights[0].created_at : null;

  // Filter + sort
  const filtered = useMemo(() => {
    let list = insights;

    if (statusFilter === "new")       list = list.filter((i) => i.status === "new");
    else if (statusFilter === "reviewed")  list = list.filter((i) => i.status === "reviewed");
    else if (statusFilter === "resolved")  list = list.filter((i) => i.status === "resolved");
    else if (statusFilter === "dismissed") list = list.filter((i) => i.status === "dismissed");

    if (typeFilter === "high_priority") list = list.filter((i) => i.severity === "high" || i.severity === "critical");
    else if (typeFilter === "campaigns") list = list.filter((i) => i.insight_type.includes("campaign"));
    else if (typeFilter === "keywords")  list = list.filter((i) => i.insight_type.includes("keyword"));
    else if (typeFilter === "quality")   list = list.filter((i) =>
      i.insight_type.includes("quality") || i.insight_type.includes("ga4") || i.insight_type.includes("blocker")
    );

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((i) =>
        i.title.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q) ||
        (i.recommendation ?? "").toLowerCase().includes(q) ||
        insightTypeLabel(i.insight_type).toLowerCase().includes(q) ||
        evidenceSearchText(i).includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const sv = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (sv !== 0) return sv;
      const au = a.updated_at ?? a.created_at;
      const bu = b.updated_at ?? b.created_at;
      return bu.localeCompare(au);
    });
  }, [insights, statusFilter, typeFilter, search]);

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all",       label: "Todos"      },
    { value: "new",       label: "Novos"      },
    { value: "reviewed",  label: "Revisados"  },
    { value: "resolved",  label: "Resolvidos" },
    { value: "dismissed", label: "Descartados"},
  ];

  const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: "all",           label: "Todos"       },
    { value: "high_priority", label: "Alta / Crítico" },
    { value: "campaigns",     label: "Campanhas"   },
    { value: "keywords",      label: "Keywords"    },
    { value: "quality",       label: "Qualidade"   },
  ];

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex items-center gap-2.5 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400 max-w-lg w-full">
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>Erro ao carregar insights: <span className="font-mono text-xs">{error}</span></span>
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-zinc-700">
        <Database size={28} className="text-zinc-800" />
        <p className="text-sm">Nenhum insight encontrado. Execute o A-Data Sync para gerar os primeiros insights.</p>
        <pre className="text-[11px] bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-500 font-mono">
          python -m connectors.a_data_sync
        </pre>
      </div>
    );
  }

  return (
    <>
      {/* Workspace label */}
      <div className="flex items-center gap-1.5 mb-4">
        <Building2 size={11} className="text-zinc-600" />
        <span className="text-[11px] text-zinc-500 font-mono">
          Insights do workspace: <span className="text-zinc-400">{DEFAULT_WORKSPACE.name}</span>
        </span>
      </div>

      {/* ── Summary cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-6">

        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Total</p>
            <Lightbulb size={14} className="text-indigo-400/60" />
          </div>
          <p className="text-3xl font-bold text-white">{totalCount}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">insights carregados</p>
        </div>

        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Novos</p>
            <AlertCircle size={14} className="text-blue-400/60" />
          </div>
          <p className="text-3xl font-bold text-blue-400">{newCount}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">aguardando revisão</p>
        </div>

        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Alta / Crítico</p>
            <AlertTriangle size={14} className="text-orange-400/60" />
          </div>
          <p className="text-3xl font-bold text-orange-400">{highCount}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">merecem atenção imediata</p>
        </div>

        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Tratados</p>
            <CheckCircle2 size={14} className="text-emerald-500/60" />
          </div>
          <p className="text-3xl font-bold text-white">{treatedCount}</p>
          <p className="text-[11px] text-zinc-600 mt-0.5">revisados ou resolvidos</p>
        </div>

        <div className="bg-[#0f1117] border border-zinc-800/60 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Atualizado</p>
            <Clock size={14} className="text-zinc-600" />
          </div>
          {lastUpdated ? (
            <>
              <p className="text-sm font-semibold text-white leading-snug">{formatDateShort(lastUpdated)}</p>
              <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">{totalCount} registros</p>
            </>
          ) : (
            <p className="text-sm text-zinc-700">—</p>
          )}
        </div>
      </div>

      {/* ── Insights list ─────────────────────────────────────────────────────── */}
      <div className="bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="p-4 border-b border-zinc-800/60 space-y-3">

          {/* Row 1: status filter + search */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 flex-wrap">
              {STATUS_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${statusFilter === value
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-zinc-500 hover:text-zinc-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 max-w-xs min-w-[160px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar insight..."
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
          </div>

          {/* Row 2: type filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-zinc-600">Tipo:</span>
            <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 flex-wrap">
              {TYPE_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setTypeFilter(value)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${typeFilter === value
                      ? "bg-zinc-700 text-zinc-200 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Microcopy */}
        <p className="text-[11px] text-zinc-600 italic px-4 py-2 border-b border-zinc-800/40 bg-zinc-900/20">
          Estes insights são determinísticos e baseados em regras. Eles não executam alterações nas campanhas.
        </p>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-zinc-700 text-sm">
            Nenhum insight encontrado para esse filtro.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {filtered.map((ins) => (
              <InsightCard
                key={ins.id}
                insight={ins}
                updatingKey={updatingKey}
                updateError={updateErrors}
                onStatusChange={updateStatus}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        {filtered.length > 0 && (
          <div className="border-t border-zinc-800/40 px-4 py-2.5">
            <p className="text-[10px] text-zinc-700 font-mono">
              {filtered.length} de {totalCount} insights
            </p>
          </div>
        )}
      </div>
    </>
  );
}
