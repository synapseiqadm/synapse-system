"use client";
import { Sparkles, ArrowRight, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NarrativeData {
  insight_summary:     string;
  technical_diagnosis: string;
  recommended_action:  string;
  priority_score:      number;
  is_simulated:        boolean;
}

// ─── Mock — mirrors exact output of ai_narrative.generate_narrative(is_simulated=True)
// Replace with live API call once fn_campaign_snapshot_delta accumulates 7+ days of syncs.

const MOCK_NARRATIVE: NarrativeData = {
  insight_summary:
    "CPA +100% em 'Conscientização | Agosto': CTR caiu 35% — fadiga criativa crítica.",
  technical_diagnosis:
    "Campaign 'Woke | Conscientização | Agosto' matches the CPA↑+CTR↓+CPC≈ pattern: " +
    "spend rose 27.55% (R$980→R$1,250) while CTR fell 34.93% (3.35%→2.18%) and CPC remained stable " +
    "— ads are shown more but clicked less, cutting conversion shots and driving CPA from R$44.55 " +
    "to R$89.29 (+100.43%, CRITICAL). " +
    "'Remarketing | Sempre Ativo' shows the opposite virtuous cycle: CPC down 31.82% (R$1.98→R$1.35) " +
    "with CTR up 39.13% (3.68%→5.12%) and conversions +72.22%, confirming budget reallocation opportunity.",
  recommended_action:
    "Substituir os criativos de 'Conscientização | Agosto' imediatamente " +
    "(testar ao menos 3 variações de headline/visual para recuperar CTR acima de 3%) " +
    "e redirecionar 15–20% do budget para 'Remarketing | Sempre Ativo', " +
    "que apresenta ciclo virtuoso com CPC em queda e CTR crescente.",
  priority_score: 5,
  is_simulated:   true,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

const PREVIEW_PREFIX = "[PREVIEW DE TESTE] ";

export function AINarrativeCard({ narrative = MOCK_NARRATIVE }: { narrative?: NarrativeData }) {
  const isAlert = narrative.priority_score >= 4;

  const summaryText = narrative.insight_summary.startsWith(PREVIEW_PREFIX)
    ? narrative.insight_summary.slice(PREVIEW_PREFIX.length)
    : narrative.insight_summary;

  return (
    <div
      className={`rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden
        border-l-[3px] ${isAlert ? "border-l-red-500" : "border-l-indigo-600/60"}`}
    >
      {/* Header */}
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

      {/* Insight summary + technical diagnosis */}
      <div className="px-5 py-4">
        <p className={`text-sm font-semibold leading-snug ${isAlert ? "text-red-100/90" : "text-zinc-100"}`}>
          {summaryText}
        </p>
        <p className="text-[11px] text-zinc-500 leading-relaxed mt-2.5">
          {narrative.technical_diagnosis}
        </p>
      </div>

      {/* Recommended action */}
      <div
        className={`px-5 py-3 border-t flex items-start gap-2.5
          ${isAlert ? "border-red-900/30 bg-red-950/[0.07]" : "border-zinc-800/40"}`}
      >
        <ArrowRight
          size={13}
          className={`mt-0.5 shrink-0 ${isAlert ? "text-red-400" : "text-indigo-400"}`}
        />
        <div className="min-w-0">
          <p className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">
            Ação Recomendada
          </p>
          <p className={`text-xs leading-relaxed ${isAlert ? "text-red-200/75" : "text-zinc-300"}`}>
            {narrative.recommended_action}
          </p>
        </div>
      </div>
    </div>
  );
}
