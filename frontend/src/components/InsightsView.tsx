"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  Loader2, AlertCircle, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Clock, Lightbulb, Search,
  Database, RefreshCw, Building2,
} from "lucide-react";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";
import { computeDecisionBrief, type DecisionSignal, type Ga4DecisionInput } from "@/lib/decision";

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

// ─── Consolidation constants ──────────────────────────────────────────────────

const GROUPABLE_TYPES = new Set([
  "campaign_zero_conversions_with_cost",
  "keyword_zero_conversions_with_cost",
]);

// Each inner array describes a set of types where only the most recent period
// should surface — they describe the same underlying condition at different
// points in time and are mutually exclusive by design.
const MUTUALLY_EXCLUSIVE_TYPES: string[][] = [
  [
    "ga4_not_configured",
    "ga4_configured_but_incomplete",
    "ga4_configured_but_no_conversion_events",
  ],
];

interface InsightGroup {
  insight_type:       string;
  items:              InsightFeedItem[];
  total_cost:         number;
  dominant_severity:  InsightSeverity;
}

type ConsolidatedItem =
  | { kind: "single"; item:  InsightFeedItem }
  | { kind: "group";  group: InsightGroup    };

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

// ─── Consolidation helpers ────────────────────────────────────────────────────

const STATUS_PRIORITY: Record<InsightStatus, number> = {
  reviewed: 0, new: 1, resolved: 2, dismissed: 3,
};

function deduplicateByDedupeKey(insights: InsightFeedItem[]): InsightFeedItem[] {
  const map = new Map<string, InsightFeedItem>();
  for (const ins of insights) {
    const key  = ins.dedupe_key ?? ins.id;
    const prev = map.get(key);
    if (!prev) { map.set(key, ins); continue; }
    const newDate  = ins.date_range_start ?? "";
    const prevDate = prev.date_range_start ?? "";
    if (newDate > prevDate) { map.set(key, ins); continue; }
    if (newDate === prevDate && STATUS_PRIORITY[ins.status] < STATUS_PRIORITY[prev.status]) {
      map.set(key, ins);
    }
  }
  return [...map.values()];
}

function applyMutualExclusion(insights: InsightFeedItem[]): InsightFeedItem[] {
  let result = [...insights];
  for (const exclusiveGroup of MUTUALLY_EXCLUSIVE_TYPES) {
    const found = exclusiveGroup.flatMap(type => result.filter(i => i.insight_type === type));
    if (found.length <= 1) continue;
    const winner = found.reduce((best, curr) =>
      (curr.date_range_start ?? "") > (best.date_range_start ?? "") ? curr : best,
    );
    const toRemove = new Set(found.filter(i => i.id !== winner.id).map(i => i.id));
    result = result.filter(i => !toRemove.has(i.id));
  }
  return result;
}

function dominantSeverity(items: InsightFeedItem[]): InsightSeverity {
  return (["critical", "high", "medium", "low"] as InsightSeverity[]).find(
    s => items.some(i => i.severity === s),
  ) ?? "low";
}

function computeConsolidated(insights: InsightFeedItem[]): ConsolidatedItem[] {
  const groupMap = new Map<string, InsightFeedItem[]>();
  const singles: InsightFeedItem[] = [];

  for (const ins of insights) {
    if (GROUPABLE_TYPES.has(ins.insight_type)) {
      const list = groupMap.get(ins.insight_type) ?? [];
      list.push(ins);
      groupMap.set(ins.insight_type, list);
    } else {
      singles.push(ins);
    }
  }

  const groupItems: ConsolidatedItem[] = [...groupMap.entries()]
    .map(([type, items]) => ({
      kind: "group" as const,
      group: {
        insight_type: type,
        items: [...items].sort((a, b) => {
          const ca = typeof a.evidence?.cost === "number" ? a.evidence.cost : 0;
          const cb = typeof b.evidence?.cost === "number" ? b.evidence.cost : 0;
          return cb - ca;
        }),
        total_cost: items.reduce(
          (sum, i) => sum + (typeof i.evidence?.cost === "number" ? i.evidence.cost : 0),
          0,
        ),
        dominant_severity: dominantSeverity(items),
      },
    }))
    .sort((a, b) => SEV_ORDER[a.group.dominant_severity] - SEV_ORDER[b.group.dominant_severity]);

  const singleItems: ConsolidatedItem[] = [...singles]
    .sort((a, b) => {
      const sv = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (sv !== 0) return sv;
      return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
    })
    .map(item => ({ kind: "single" as const, item }));

  return [...groupItems, ...singleItems];
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
  compact?: boolean;
}

function InsightCard({ insight, updatingKey, updateError, onStatusChange, compact = false }: InsightCardProps) {
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
      <div className={`flex items-start justify-between gap-3 ${compact ? "px-3 pt-3 pb-1.5" : "px-4 pt-4 pb-2"}`}>
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
      <div className={compact ? "px-3 pb-2" : "px-4 pb-3"}>
        <p className={`font-semibold text-zinc-100 mb-1.5 leading-snug ${compact ? "text-xs" : "text-sm"}`}>{insight.title}</p>
        <p className="text-xs text-zinc-400 leading-relaxed mb-2">{insight.summary}</p>
        {!compact && insight.recommendation && (
          <div className="flex gap-2 bg-zinc-900/60 border border-zinc-800/40 rounded-lg px-3 py-2">
            <Lightbulb size={12} className="text-amber-500/70 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-400 leading-relaxed">{insight.recommendation}</p>
          </div>
        )}
      </div>

      {/* Period */}
      {insight.date_range_start && (
        <div className={compact ? "px-3 pb-1.5" : "px-4 pb-2"}>
          <p className="text-[10px] text-zinc-700 font-mono">
            Período: {formatDateOnly(insight.date_range_start)} → {formatDateOnly(insight.date_range_end ?? "")}
          </p>
        </div>
      )}

      {/* Error */}
      {cardErr && (
        <div className={`${compact ? "mx-3" : "mx-4"} mb-2 flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-1.5`}>
          <AlertCircle size={11} />
          {cardErr}
        </div>
      )}

      {/* Footer: actions + expand */}
      <div className={`flex items-center justify-between gap-2 ${compact ? "px-3 pb-3" : "px-4 pb-4"} border-t border-zinc-800/40 pt-2.5 flex-wrap gap-y-2`}>
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

// ─── InsightGroupCard ─────────────────────────────────────────────────────────

const GROUP_LABELS: Record<string, {
  typeLabel:   string;
  headline:    (n: number) => string;
  expandLabel: (n: number) => string;
}> = {
  campaign_zero_conversions_with_cost: {
    typeLabel:   "Campanhas Sem Conversão",
    headline:    (n) => `${n} campanha${n !== 1 ? "s" : ""} ${n !== 1 ? "consumiram" : "consumiu"} verba sem registrar conversões`,
    expandLabel: (n) => `Ver ${n} campanha${n !== 1 ? "s" : ""} afetada${n !== 1 ? "s" : ""}`,
  },
  keyword_zero_conversions_with_cost: {
    typeLabel:   "Keywords Sem Conversão",
    headline:    (n) => `${n} keyword${n !== 1 ? "s" : ""} ${n !== 1 ? "consumiram" : "consumiu"} verba sem gerar conversões`,
    expandLabel: (n) => `Ver ${n} keyword${n !== 1 ? "s" : ""} afetada${n !== 1 ? "s" : ""}`,
  },
};

function InsightGroupCard({ group, updatingKey, updateError, onStatusChange }: {
  group: InsightGroup;
  updatingKey: string | null;
  updateError: Record<string, string>;
  onStatusChange: (id: string, to: InsightStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = GROUP_LABELS[group.insight_type];

  const severityLeft = {
    critical: "border-l-red-500",
    high:     "border-l-orange-500",
    medium:   "border-l-amber-500/70",
    low:      "border-l-zinc-700",
  }[group.dominant_severity];

  return (
    <div className={`bg-[#0f1117] border border-zinc-800/60 rounded-xl overflow-hidden border-l-2 ${severityLeft}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{cfg.typeLabel}</span>
          <SeverityBadge severity={group.dominant_severity} />
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-800/60 text-zinc-400 border-zinc-700/40">
            {group.items.length} {group.insight_type.includes("keyword") ? "keywords" : "campanhas"}
          </span>
        </div>
        <p className="text-sm font-semibold text-zinc-100 leading-snug mb-3">
          {cfg.headline(group.items.length)}
        </p>
        {/* Aggregate metrics */}
        <div className="flex items-center gap-6">
          {group.total_cost > 0 && (
            <div>
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Custo total</p>
              <p className="text-base font-bold text-amber-400 font-mono">{formatBRL(group.total_cost)}</p>
            </div>
          )}
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Conversões</p>
            <p className="text-base font-bold text-red-400/80 font-mono">0</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-0.5">Afetados</p>
            <p className="text-base font-bold text-zinc-300 font-mono">{group.items.length}</p>
          </div>
        </div>
      </div>

      {/* Expand toggle */}
      <div className="px-4 py-2.5 border-t border-zinc-800/40">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Fechar detalhe" : cfg.expandLabel(group.items.length)}
        </button>
      </div>

      {/* Drilldown — compact cards with max-height scroll */}
      {expanded && (
        <div className="border-t border-zinc-800/60 max-h-96 overflow-y-auto">
          <div className="p-3 space-y-2">
            {group.items.map(item => (
              <InsightCard
                key={item.id}
                insight={item}
                updatingKey={updatingKey}
                updateError={updateError}
                onStatusChange={onStatusChange}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DecisionBriefSection ─────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  priority:    "Prioridade",
  risk:        "Risco",
  opportunity: "Oportunidade",
  tracking:    "Rastreamento",
};

const URGENCY_STYLE: Record<string, { border: string; dot: string; text: string }> = {
  high:   { border: "border-l-amber-500",    dot: "bg-amber-400",   text: "text-amber-300/90" },
  medium: { border: "border-l-zinc-600/60",  dot: "bg-zinc-500",    text: "text-zinc-300"     },
  low:    { border: "border-l-zinc-700/40",  dot: "bg-zinc-600/50", text: "text-zinc-400"     },
};

function DecisionBriefSection({ signals }: { signals: DecisionSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div className="mb-5 bg-[#0d0d10] border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/40 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Resumo para Decisão</p>
        <p className="text-[10px] text-zinc-700">Derivado dos insights do período · determinístico</p>
      </div>
      <div className="divide-y divide-zinc-800/30">
        {signals.map((s, idx) => {
          const uc = URGENCY_STYLE[s.urgency];
          return (
            <div key={idx} className={`px-4 py-3 border-l-2 ${uc.border}`}>
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5 min-w-[90px]">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${uc.dot}`} />
                  <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                    {CATEGORY_LABEL[s.category]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-relaxed ${uc.text}`}>{s.statement}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{s.direction}</p>
                </div>
                <span className="text-[10px] text-zinc-700 shrink-0 pt-0.5 font-mono">conf.&nbsp;{s.confidence}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Filter / sort types ──────────────────────────────────────────────────────

type StatusFilter = "all" | "new" | "reviewed" | "resolved" | "dismissed";
type TypeFilter   = "all" | "high_priority" | "campaigns" | "keywords" | "quality";

// ─── Main view ────────────────────────────────────────────────────────────────

export function InsightsView({ workspaceId }: { workspaceId: string }) {
  const supabase = createClient();

  const [insights, setInsights]     = useState<InsightFeedItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>("all");
  const [search, setSearch]             = useState("");
  const [updatingKey, setUpdatingKey]   = useState<string | null>(null);
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({});
  const [ga4Input, setGa4Input]         = useState<Ga4DecisionInput | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null);
      const { data, error: sbError } = await supabase
        .from("insight_feed")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (sbError) { setError(sbError.message); setLoading(false); return; }
      setInsights((data as InsightFeedItem[]) ?? []);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    async function loadGa4() {
      const { data } = await supabase
        .from("ga4_first_light_summary")
        .select("sessions, top_events")
        .eq("workspace_id", workspaceId)
        .limit(1)
        .maybeSingle();
      if (data) {
        setGa4Input({
          sessions:   typeof data.sessions === "number" ? data.sessions : 0,
          top_events: Array.isArray(data.top_events) ? (data.top_events as Ga4DecisionInput["top_events"]) : [],
        });
      }
    }
    loadGa4();
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

  // Deduplicate by dedupe_key (latest period wins; reviewed > new on tie)
  // then enforce mutual exclusion between semantically equivalent GA4 types.
  const deduped = useMemo(() => {
    const d = deduplicateByDedupeKey(insights);
    return applyMutualExclusion(d);
  }, [insights]);

  // Derived summary stats (operate on deduped signals, not raw rows)
  const totalCount   = deduped.length;
  const newCount     = deduped.filter((i) => i.status === "new").length;
  const highCount    = deduped.filter((i) => i.severity === "high" || i.severity === "critical").length;
  const treatedCount = deduped.filter((i) => i.status === "reviewed" || i.status === "resolved").length;
  const lastUpdated  = insights.length > 0 ? insights[0].updated_at ?? insights[0].created_at : null;

  // Filter + sort (operates on deduped signals)
  const filtered = useMemo(() => {
    let list = deduped;

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
  }, [deduped, statusFilter, typeFilter, search]);

  // Group groupable types into summary cards; singletons stay individual
  const consolidated = useMemo(() => computeConsolidated(filtered), [filtered]);

  const decisionBrief = useMemo(
    () => computeDecisionBrief(deduped, ga4Input),
    [deduped, ga4Input],
  );

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

      {/* ── Decision brief ───────────────────────────────────────────────────── */}
      <DecisionBriefSection signals={decisionBrief} />

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
        {consolidated.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-zinc-700 text-sm">
            Nenhum insight encontrado para esse filtro.
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {consolidated.map((item) =>
              item.kind === "group" ? (
                <InsightGroupCard
                  key={`group-${item.group.insight_type}`}
                  group={item.group}
                  updatingKey={updatingKey}
                  updateError={updateErrors}
                  onStatusChange={updateStatus}
                />
              ) : (
                <InsightCard
                  key={item.item.id}
                  insight={item.item}
                  updatingKey={updatingKey}
                  updateError={updateErrors}
                  onStatusChange={updateStatus}
                />
              )
            )}
          </div>
        )}

        {/* Footer */}
        {consolidated.length > 0 && (
          <div className="border-t border-zinc-800/40 px-4 py-2.5">
            <p className="text-[10px] text-zinc-700 font-mono">
              {consolidated.length} item{consolidated.length !== 1 ? "s" : ""} · {deduped.length} sinais únicos · {insights.length} registros
            </p>
          </div>
        )}
      </div>
    </>
  );
}
