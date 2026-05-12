"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, ArrowRight, AlertTriangle, Loader2, WifiOff, ExternalLink } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NarrativeData {
  insight_summary:     string;
  technical_diagnosis: string;
  recommended_action:  string;
  priority_score:      number;
  is_simulated:        boolean;
}

type FetchState =
  | { status: "loading" }
  | { status: "success"; narrative: NarrativeData }
  | { status: "offline" };

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

function LoadingSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden border-l-[3px] border-l-indigo-600/30">
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center gap-2">
        <Loader2 size={13} className="text-indigo-400 shrink-0 animate-spin" />
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider">
          Executive Insight
        </span>
      </div>
      <div className="px-5 py-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5 text-zinc-500">
          <Loader2 size={14} className="animate-spin shrink-0" />
          <span className="text-[11px]">Sincronizando com a Inteligência Synapse...</span>
        </div>
        <div className="space-y-2 animate-pulse">
          <div className="h-2 bg-zinc-800 rounded w-3/4" />
          <div className="h-2 bg-zinc-800 rounded w-full" />
          <div className="h-2 bg-zinc-800 rounded w-5/6" />
        </div>
      </div>
    </div>
  );
}

function OfflineCard() {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-[#0f1117] overflow-hidden border-l-[3px] border-l-zinc-700">
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center gap-2">
        <Sparkles size={13} className="text-zinc-600 shrink-0" />
        <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
          Executive Insight
        </span>
      </div>
      <div className="px-5 py-5 flex items-center gap-3 text-zinc-600">
        <WifiOff size={14} className="shrink-0" />
        <span className="text-xs">Inteligência temporariamente offline.</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const PREVIEW_PREFIX = "[PREVIEW DE TESTE] ";

export function AINarrativeCard() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

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
  }, []);

  if (state.status === "loading") return <LoadingSkeleton />;
  if (state.status === "offline")  return <OfflineCard />;

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
