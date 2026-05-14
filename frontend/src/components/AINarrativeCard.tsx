"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles, ArrowRight, AlertTriangle, Loader2, WifiOff, ExternalLink,
  TrendingUp, TrendingDown, Minus, Lightbulb,
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
        <MetricCell
          label="Investimento"
          value={kpi.totalSpend !== null ? fmtBRLCompact(kpi.totalSpend) : "—"}
        />
        <MetricCell
          label="CPC médio"
          value={kpi.cpc !== null ? `R$ ${kpi.cpc.toFixed(2).replace(".", ",")}` : "—"}
        />
        <MetricCell
          label="CTR médio"
          value={kpi.ctr !== null ? fmtPctDecimal(kpi.ctr) : "—"}
        />
      </div>
    </div>
  );
}

function NarrativeBox({
  summary,
  diagnosis,
  isAlert,
}: {
  summary:   string;
  diagnosis: string;
  isAlert:   boolean;
}) {
  return (
    <div className="mx-5 my-3 rounded-lg border border-zinc-700/40 bg-zinc-900 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <Lightbulb
          size={13}
          className={`mt-0.5 shrink-0 ${isAlert ? "text-amber-400" : "text-indigo-400/80"}`}
        />
        <div className="min-w-0">
          <p className={`text-sm font-semibold leading-snug ${isAlert ? "text-red-100/90" : "text-zinc-100"}`}>
            {summary}
          </p>
          <p className="text-[11px] text-zinc-500 leading-relaxed mt-2">
            {diagnosis}
          </p>
        </div>
      </div>
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
      {/* Narrative skeleton */}
      <div className="mx-5 my-3 rounded-lg border border-zinc-700/40 bg-zinc-900 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Loader2 size={13} className="text-indigo-400/60 shrink-0 animate-spin mt-0.5" />
          <div className="flex-1 space-y-2 animate-pulse">
            <div className="h-2.5 bg-zinc-700/80 rounded w-full" />
            <div className="h-2.5 bg-zinc-700/80 rounded w-5/6" />
            <div className="h-2 bg-zinc-800 rounded w-4/6 mt-3" />
            <div className="h-2 bg-zinc-800 rounded w-full" />
            <div className="h-2 bg-zinc-800 rounded w-3/4" />
          </div>
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
    ? { wrap: "bg-red-500/10 border-red-500/20",       text: "text-red-300",    sub: "text-red-500/70"     }
    : isUnder
    ? { wrap: "bg-indigo-500/10 border-indigo-500/20", text: "text-indigo-300", sub: "text-indigo-500/70"  }
    : { wrap: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-300", sub: "text-emerald-600" };

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
            <span className={`text-[10px] ${colors.sub}`}>
              · {pacing.days_until_exhaustion}d até esgotar
            </span>
          )}
        </div>
        {pacing.recommendation && (
          <p className={`text-[10px] mt-0.5 leading-relaxed ${colors.sub}`}>
            {pacing.recommendation}
          </p>
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

      {/* Layers 1 + 2: KPI metrics (always shown, from parent state) */}
      {kpi && <KpiLayer kpi={kpi} />}

      {/* Layer 3: AI Narrative conseil box */}
      <NarrativeBox
        summary={summaryText}
        diagnosis={narrative.technical_diagnosis}
        isAlert={isAlert}
      />

      {/* Budget pacing */}
      {narrative.budget_pacing && (
        <BudgetPacingBadge pacing={narrative.budget_pacing} />
      )}

      {/* Playbook checklist */}
      {narrative.suggested_playbooks && narrative.suggested_playbooks.length > 0 && (
        <PlaybookChecklist playbooks={narrative.suggested_playbooks} />
      )}

      {/* Probable causes */}
      {narrative.probable_causes && narrative.probable_causes.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">
            Causas Prováveis
          </p>
          <div className="space-y-1.5">
            {narrative.probable_causes.map((c, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border tracking-wide ${
                  c.layer === "tracking"  ? "bg-red-500/15 text-red-400 border-red-500/20"       :
                  c.layer === "creative"  ? "bg-amber-500/15 text-amber-400 border-amber-500/20"   :
                  c.layer === "audience"  ? "bg-violet-500/15 text-violet-400 border-violet-500/20" :
                  c.layer === "landing"   ? "bg-orange-500/15 text-orange-400 border-orange-500/20" :
                                           "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                }`}>
                  {c.layer.toUpperCase()}
                </span>
                <span className={`shrink-0 mt-[3px] w-1.5 h-1.5 rounded-full ${
                  c.confidence === "high"   ? "bg-red-400"   :
                  c.confidence === "medium" ? "bg-amber-400" :
                                             "bg-zinc-600"
                }`} title={c.confidence} />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-300 font-medium leading-tight">{c.cause}</p>
                  <p className="text-[9px] text-zinc-600 leading-relaxed">{c.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommended action */}
      <div
        className={`px-5 py-3.5 border-t flex items-start gap-2.5
          ${isAlert ? "border-red-900/30 bg-red-950/[0.07]" : "border-zinc-800/40"}`}
      >
        <ArrowRight
          size={13}
          className={`mt-0.5 shrink-0 ${isAlert ? "text-red-400" : "text-indigo-400"}`}
        />
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
