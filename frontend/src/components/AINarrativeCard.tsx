"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles, ArrowRight, AlertTriangle, Loader2, WifiOff, ExternalLink,
  TrendingUp, TrendingDown, Minus, Lightbulb, Zap,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KpiContext {
  roas:             number | null;
  trendDelta:       number;
  totalSpend:       number | null;
  totalConversions: number | null;
  cpc:              number | null;
  ctr:              number | null; // decimal: 0.025 = 2.5%
}

interface ProbableCause {
  layer:      "tracking" | "creative" | "audience" | "landing" | "budget";
  confidence: "high" | "medium" | "low";
  cause:      string;
  evidence:   string;
}

interface BudgetPacingData {
  pacing_status:         "over" | "under" | "on_track";
  estimated_total_spend: number;
  days_until_exhaustion: number | null;
  recommendation:        string;
}

interface SuggestedPlaybook {
  task:   string;
  impact: string;
  effort: "low" | "medium" | "high";
}

interface NarrativeData {
  insight_summary:     string;
  technical_diagnosis: string;
  recommended_action:  string;
  priority_score:      number;
  is_simulated:        boolean;
  probable_causes?:    ProbableCause[];
  budget_pacing?:      BudgetPacingData;
  suggested_playbooks?: SuggestedPlaybook[];
}

type FetchState =
  | { status: "loading" }
  | { status: "success"; narrative: NarrativeData }
  | { status: "offline" };

// ─── Diagnostic parser ────────────────────────────────────────────────────────

interface DiagnosticEntry {
  kind:     "waste" | "fault" | "anomaly" | "tracking";
  severity: "fatal" | "performance";
  label:    string;
  value:    string;
  url?:     string;
}

function parseDiagnostics(causes: ProbableCause[], diagnosis: string): DiagnosticEntry[] {
  const entries: DiagnosticEntry[] = [];

  // Primary: structured probable_causes (most reliable, already categorised by AI)
  for (const c of causes) {
    if (c.layer === "tracking") {
      entries.push({ kind: "tracking", severity: "fatal", label: c.cause, value: c.evidence });
    } else if (c.layer === "landing") {
      const url = diagnosis.match(/https?:\/\/[^\s'")\]]+/)?.[0];
      entries.push({ kind: "fault", severity: "fatal", label: c.cause, value: c.evidence, url });
    } else if (c.layer === "budget") {
      const sev = c.confidence === "high" ? "fatal" : "performance";
      entries.push({ kind: "waste", severity: sev, label: c.cause, value: c.evidence });
    } else if (c.layer === "creative" || c.layer === "audience") {
      entries.push({ kind: "anomaly", severity: "performance", label: c.cause, value: c.evidence });
    }
  }

  // Fallback: text parsing for items not already covered

  // Waste: R$ amount near "zero conversions"
  if (!entries.some(e => e.kind === "waste")) {
    const wm = diagnosis.match(/(R\$\s*[\d.,]+(?:k|K)?)\b[^.]*?(?:zero|ZERO|0)\s+conversions?/i);
    if (wm) entries.push({ kind: "waste", severity: "fatal", label: "Verba sem retorno", value: wm[1] });
  }

  // 404: URL 'X' returns 404
  if (!entries.some(e => e.kind === "fault")) {
    const fm = diagnosis.match(/URL\s+'([^']+)'\s+(?:returns?|retorna)\s+404/i);
    if (fm) {
      const raw = fm[1];
      entries.push({
        kind: "fault", severity: "fatal",
        label: "Página inacessível (404)",
        value: raw.length > 45 ? raw.slice(0, 42) + "…" : raw,
        url: raw,
      });
    }
  }

  // Tracking keywords
  if (!entries.some(e => e.kind === "tracking")) {
    if (/utm[^.]{0,40}(?:broken|compromised|missing|empty)|attribution\s+(?:broken|compromised)/i.test(diagnosis)) {
      entries.push({ kind: "tracking", severity: "fatal", label: "Tracking comprometido", value: "UTM attribution" });
    }
  }

  // Load time ≥ 3 s
  const lm = diagnosis.match(/(\d{4,})\s*ms/);
  if (lm) {
    entries.push({
      kind: "anomaly", severity: "performance",
      label: "Tempo de carregamento",
      value: `${parseInt(lm[1]).toLocaleString("pt-BR")} ms`,
    });
  }

  // Large-percentage anomaly (≥ 100 %)
  if (!entries.some(e => e.kind === "anomaly")) {
    const pm = [...diagnosis.matchAll(/([+-]?\d{3,}(?:[,.]\d+)?%)/g)];
    if (pm.length > 0) entries.push({ kind: "anomaly", severity: "performance", label: "Anomalia de ROAS", value: pm[0][1] });
  }

  // Sort fatal first, then performance
  return entries.sort((a, b) => {
    if (a.severity === "fatal" && b.severity !== "fatal") return -1;
    if (b.severity === "fatal" && a.severity !== "fatal") return 1;
    return 0;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRLCompact(v: number): string {
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1).replace(".", ",")}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

function fmtPctDecimal(ratio: number): string {
  return (ratio * 100).toFixed(1).replace(".", ",") + "%";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DeltaChip({ delta }: { delta: number }) {
  const isPos = delta >= 0;
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className={`text-[10px] leading-none ${isPos ? "text-emerald-400" : "text-red-400"}`}>
        {isPos ? "▲" : "▼"}
      </span>
      <span className="text-[11px] font-mono text-zinc-500">
        {Math.abs(delta).toFixed(1).replace(".", ",")}%
      </span>
    </span>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-zinc-300 font-mono">{value}</p>
    </div>
  );
}

function KpiLayer({ kpi }: { kpi: KpiContext }) {
  const showDelta = Math.abs(kpi.trendDelta) >= 0.5;
  return (
    <div className="px-5 pt-4 pb-3 border-b border-zinc-800/30">
      {/* Layer 1 — primary metric */}
      <div className="flex items-end gap-3 mb-3">
        <div>
          <p className="text-[9px] font-medium text-zinc-600 uppercase tracking-widest mb-0.5">ROAS · período</p>
          <div className="flex items-end gap-2">
            <span className="text-2xl font-bold leading-none font-mono text-zinc-100">
              {kpi.roas !== null ? `${kpi.roas.toFixed(2).replace(".", ",")}x` : "—"}
            </span>
            {showDelta && <DeltaChip delta={kpi.trendDelta} />}
          </div>
        </div>
      </div>

      {/* Layer 2 — secondary metrics */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCell label="Investimento" value={kpi.totalSpend !== null ? fmtBRLCompact(kpi.totalSpend) : "—"} />
        <MetricCell label="CPC médio"    value={kpi.cpc !== null ? `R$ ${kpi.cpc.toFixed(2).replace(".", ",")}` : "—"} />
        <MetricCell label="CTR médio"    value={kpi.ctr !== null ? fmtPctDecimal(kpi.ctr) : "—"} />
      </div>
    </div>
  );
}

// ─── DiagnosticItem ───────────────────────────────────────────────────────────

function DiagnosticItem({ entry }: { entry: DiagnosticEntry }) {
  const isFatal = entry.severity === "fatal";

  const Icon =
    entry.kind === "waste"    ? TrendingDown  :
    entry.kind === "tracking" ? WifiOff       :
    entry.kind === "fault"    ? AlertTriangle :
                                Zap;

  const s = isFatal
    ? { wrap: "bg-red-500/10 border-red-500/20",     icon: "text-red-400",   label: "text-red-300",   value: "text-red-200/70"   }
    : { wrap: "bg-amber-500/10 border-amber-500/20", icon: "text-amber-400", label: "text-amber-300", value: "text-amber-200/70" };

  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${s.wrap}`}>
      <Icon size={11} className={`shrink-0 ${s.icon}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-[9px] font-bold uppercase tracking-wider leading-none mb-0.5 ${s.label}`}>
          {entry.label}
        </p>
        <p className={`text-[11px] font-mono leading-tight truncate ${s.value}`}>
          {entry.value}
        </p>
      </div>
      {entry.url && (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1 text-[9px] font-semibold text-red-400/80 hover:text-red-300 border border-red-500/20 rounded px-1.5 py-0.5 whitespace-nowrap transition-colors"
        >
          Ver URL <ExternalLink size={8} />
        </a>
      )}
    </div>
  );
}

// ─── DiagnosticPanel (Layer 3) ────────────────────────────────────────────────

function DiagnosticPanel({
  summary,
  diagnosis,
  isAlert,
  causes,
}: {
  summary:   string;
  diagnosis: string;
  isAlert:   boolean;
  causes:    ProbableCause[];
}) {
  const diagnostics = parseDiagnostics(causes, diagnosis);

  return (
    <div className="mx-5 my-3 rounded-lg border border-zinc-700/40 bg-zinc-900 px-4 py-3">
      {/* Summary — conseil header, max 2 lines */}
      <div className="flex items-start gap-2.5 mb-3">
        <Lightbulb size={13} className={`mt-0.5 shrink-0 ${isAlert ? "text-amber-400" : "text-indigo-400/80"}`} />
        <p className={`text-sm font-semibold leading-snug line-clamp-2 ${isAlert ? "text-red-100/90" : "text-zinc-100"}`}>
          {summary}
        </p>
      </div>

      {/* Diagnostic items — fatal first, then performance */}
      {diagnostics.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {diagnostics.map((e, i) => (
            <DiagnosticItem key={i} entry={e} />
          ))}
        </div>
      )}

      {/* Supporting technical detail — max 3 lines */}
      <p className="text-[10px] text-zinc-600 leading-relaxed line-clamp-3">
        {diagnosis}
      </p>
    </div>
  );
}

function PriorityDots({ score, alert }: { score: number; alert: boolean }) {
  const filled = alert ? "bg-red-500" : score >= 3 ? "bg-amber-400" : "bg-indigo-500";
  return (
    <div className="flex items-center gap-1" title={`Prioridade ${score}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < score ? filled : "bg-zinc-700"}`} />
      ))}
    </div>
  );
}

function LoadingSkeleton({ kpi }: { kpi?: KpiContext }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden border-l-[3px] border-l-indigo-600/30">
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center gap-2">
        <Loader2 size={13} className="text-indigo-400 shrink-0 animate-spin" />
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
          Executive Insight
        </span>
      </div>
      {kpi && <KpiLayer kpi={kpi} />}
      {/* Diagnostic panel skeleton */}
      <div className="mx-5 my-3 rounded-lg border border-zinc-700/40 bg-zinc-900 px-4 py-3">
        <div className="flex items-start gap-2.5 mb-3 animate-pulse">
          <div className="mt-0.5 w-3 h-3 rounded-full bg-zinc-700 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 bg-zinc-700/80 rounded w-full" />
            <div className="h-2.5 bg-zinc-700/80 rounded w-4/5" />
          </div>
        </div>
        <div className="space-y-1.5 mb-3 animate-pulse">
          <div className="h-9 bg-red-500/8 border border-red-500/10 rounded-lg" />
          <div className="h-9 bg-amber-500/8 border border-amber-500/10 rounded-lg" />
        </div>
        <div className="space-y-1 animate-pulse">
          <div className="h-2 bg-zinc-800 rounded w-full" />
          <div className="h-2 bg-zinc-800 rounded w-5/6" />
          <div className="h-2 bg-zinc-800 rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}

function OfflineCard({ kpi }: { kpi?: KpiContext }) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden border-l-[3px] border-l-zinc-700">
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center gap-2">
        <Sparkles size={13} className="text-zinc-600 shrink-0" />
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          Executive Insight
        </span>
      </div>
      {kpi && <KpiLayer kpi={kpi} />}
      <div className="mx-5 my-3 rounded-lg border border-zinc-700/40 bg-zinc-900 px-4 py-3 flex items-center gap-3 text-zinc-600">
        <WifiOff size={13} className="shrink-0" />
        <span className="text-xs">Inteligência temporariamente offline.</span>
      </div>
    </div>
  );
}

function BudgetPacingBadge({ pacing }: { pacing: BudgetPacingData }) {
  const isOver  = pacing.pacing_status === "over";
  const isUnder = pacing.pacing_status === "under";

  const colors = isOver
    ? { wrap: "bg-red-500/10 border-red-500/20",         text: "text-red-300",    sub: "text-red-500/70"    }
    : isUnder
    ? { wrap: "bg-indigo-500/10 border-indigo-500/20",   text: "text-indigo-300", sub: "text-indigo-500/70" }
    : { wrap: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-300", sub: "text-emerald-600"  };

  const Icon  = isOver ? TrendingUp : isUnder ? TrendingDown : Minus;
  const label = isOver ? "PACING: ESTOURO" : isUnder ? "PACING: SUB-UTILIZAÇÃO" : "PACING: NO RITMO";

  return (
    <div className={`mx-5 mb-3 flex items-start gap-2.5 rounded-lg border px-3 py-2 ${colors.wrap}`}>
      <Icon size={12} className={`mt-0.5 shrink-0 ${colors.text}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[9px] font-bold tracking-widest uppercase ${colors.text}`}>{label}</span>
          <span className={`text-[10px] font-mono ${colors.text}`}>
            R${pacing.estimated_total_spend.toFixed(2)} projetado
          </span>
          {pacing.days_until_exhaustion != null && (
            <span className={`text-[10px] ${colors.sub}`}>· {pacing.days_until_exhaustion}d até esgotar</span>
          )}
        </div>
        {pacing.recommendation && (
          <p className={`text-[10px] mt-0.5 leading-relaxed ${colors.sub}`}>{pacing.recommendation}</p>
        )}
      </div>
    </div>
  );
}

function PlaybookChecklist({ playbooks }: { playbooks: SuggestedPlaybook[] }) {
  if (playbooks.length === 0) return null;

  const effortColors: Record<string, string> = {
    low:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    high:   "bg-red-500/15 text-red-400 border-red-500/20",
  };
  const effortLabel: Record<string, string> = { low: "BAIXO", medium: "MÉDIO", high: "ALTO" };

  return (
    <div className="mx-5 mb-3 rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-3 py-2.5">
      <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">
        Checklist de Contingência
      </p>
      <div className="space-y-2">
        {playbooks.map((p, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-[2px] w-3 h-3 shrink-0 rounded border border-zinc-700 bg-zinc-900" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[10px] text-slate-300 font-medium leading-tight">{p.task}</p>
                <span className={`shrink-0 text-[8px] font-bold px-1 py-0.5 rounded border tracking-wide ${effortColors[p.effort] ?? effortColors.medium}`}>
                  {effortLabel[p.effort] ?? p.effort.toUpperCase()}
                </span>
              </div>
              {p.impact && (
                <p className="text-[9px] text-zinc-600 leading-relaxed mt-0.5">{p.impact}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PREVIEW_PREFIX = "[PREVIEW DE TESTE] ";

export function AINarrativeCard({
  kpi,
  workspaceId,
}: {
  kpi?:         KpiContext;
  workspaceId?: string;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetch("/api/ai/narrative")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body.ok && body.data) {
          setState({ status: "success", narrative: body.data as NarrativeData });
        } else {
          setState({ status: "offline" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "offline" });
      });

    return () => { cancelled = true; };
  }, [workspaceId]);

  if (state.status === "loading") return <LoadingSkeleton kpi={kpi} />;
  if (state.status === "offline")  return <OfflineCard kpi={kpi} />;

  const { narrative } = state;
  const isAlert = narrative.priority_score >= 4;

  const summaryText = narrative.insight_summary.startsWith(PREVIEW_PREFIX)
    ? narrative.insight_summary.slice(PREVIEW_PREFIX.length)
    : narrative.insight_summary;

  return (
    <div
      className={`rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden
        border-l-[3px] ${isAlert ? "border-l-red-500" : "border-l-indigo-600/60"}`}
    >
      {/* Header bar */}
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={13} className={isAlert ? "text-red-400 shrink-0" : "text-indigo-400 shrink-0"} />
          <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider shrink-0">
            Executive Insight
          </span>
          {narrative.is_simulated && (
            <span className="text-[9px] font-bold text-zinc-500 bg-zinc-800/80 border border-zinc-700/50 rounded px-1.5 py-0.5 tracking-wide shrink-0">
              PREVIEW DE TESTE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAlert && <AlertTriangle size={12} className="text-red-400/80" />}
          <PriorityDots score={narrative.priority_score} alert={isAlert} />
          <span className="text-[10px] font-mono text-zinc-600">P{narrative.priority_score}</span>
        </div>
      </div>

      {/* Layers 1 + 2: KPI metrics */}
      {kpi && <KpiLayer kpi={kpi} />}

      {/* Layer 3: Structured diagnostic panel */}
      <DiagnosticPanel
        summary={summaryText}
        diagnosis={narrative.technical_diagnosis}
        isAlert={isAlert}
        causes={narrative.probable_causes ?? []}
      />

      {/* Budget pacing */}
      {narrative.budget_pacing && (
        <BudgetPacingBadge pacing={narrative.budget_pacing} />
      )}

      {/* Playbook checklist */}
      {narrative.suggested_playbooks && narrative.suggested_playbooks.length > 0 && (
        <PlaybookChecklist playbooks={narrative.suggested_playbooks} />
      )}

      {/* Recommended action */}
      <div
        className={`px-5 py-3.5 border-t flex items-start gap-2.5
          ${isAlert ? "border-red-900/30 bg-red-950/[0.07]" : "border-zinc-800/40"}`}
      >
        <ArrowRight size={13} className={`mt-0.5 shrink-0 ${isAlert ? "text-red-400" : "text-indigo-400"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">
            Ação Recomendada
          </p>
          <p className={`text-xs leading-relaxed ${isAlert ? "text-red-200/75" : "text-zinc-300"}`}>
            {narrative.recommended_action}
          </p>
        </div>
      </div>

      {/* Link to Operations Center */}
      <div className="px-5 py-2.5 border-t border-zinc-800/40 flex justify-end">
        <Link
          href="/agents"
          className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 hover:text-indigo-400 transition-colors"
        >
          Ver no Centro de Operações
          <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  );
}
