import type { GrowthFunnelEvent } from "@/types/growth";
import { EVENT_FUNNEL_MAP } from "@/lib/measurementConfig";

export type FunnelStep = "acquisition" | "landing" | "engagement" | "intent" | "conversion";

export const FUNNEL_STEP_ORDER: readonly FunnelStep[] = [
  "acquisition", "landing", "engagement", "intent", "conversion",
];

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  acquisition: "Aquisição",
  landing:     "Landing",
  engagement:  "Engajamento",
  intent:      "Intenção",
  conversion:  "Conversão",
};

export interface FunnelStageMetric {
  step: FunnelStep;
  label: string;
  events: number;
  semantic_events: number;  // events minus suspicious-named ones
  suspicious_events: number;
}

export interface FunnelDropoff {
  from_step: FunnelStep;
  to_step: FunnelStep;
  from_events: number;
  to_events: number;
  pct: number; // negative fraction, e.g. -0.838 means −83.8%
}

export interface SuspiciousEvent {
  event_name: string;
  count: number;
}

export interface FunnelIntelligence {
  stages: FunnelStageMetric[];
  total_events: number;
  intent_rate: number | null;          // intent_events / sessions
  conversion_rate: number | null;      // conversion_events / sessions
  intent_to_conversion: number | null; // conversion_events / intent_events
  biggest_dropoff: FunnelDropoff | null;
  suspicious_events: SuspiciousEvent[];
  suspicious_share: number;  // 0..1
  semantic_coverage: number; // 1 - suspicious_share
  health: "healthy" | "attention" | "limited" | "no_data";
}

// Events in the registry are semantically validated — never flagged as suspicious.
// Events whose names contain uppercase letters don't follow the GA4 snake_case
// convention and have no semantic classification in the registry.
export function isSuspiciousEventName(name: string): boolean {
  if (EVENT_FUNNEL_MAP[name.toLowerCase()] !== undefined) return false;
  return name !== name.toLowerCase();
}

export function computeFunnelIntelligence(
  events: GrowthFunnelEvent[],
  sessions: number,
): FunnelIntelligence {
  const empty: FunnelIntelligence = {
    stages: FUNNEL_STEP_ORDER.map(step => ({
      step, label: FUNNEL_STEP_LABELS[step],
      events: 0, semantic_events: 0, suspicious_events: 0,
    })),
    total_events: 0,
    intent_rate: null,
    conversion_rate: null,
    intent_to_conversion: null,
    biggest_dropoff: null,
    suspicious_events: [],
    suspicious_share: 0,
    semantic_coverage: 1,
    health: "no_data",
  };

  if (events.length === 0 || sessions === 0) return empty;

  // Group by funnel step
  const byStep = new Map<FunnelStep, GrowthFunnelEvent[]>(
    FUNNEL_STEP_ORDER.map(s => [s, []]),
  );
  for (const ev of events) {
    byStep.get(ev.step as FunnelStep)?.push(ev);
  }

  const total_events = events.reduce((s, e) => s + e.event_count, 0);

  const stages: FunnelStageMetric[] = FUNNEL_STEP_ORDER.map(step => {
    const stepEvents = byStep.get(step)!;
    const total     = stepEvents.reduce((s, e) => s + e.event_count, 0);
    const suspicious = stepEvents
      .filter(e => isSuspiciousEventName(e.event_name))
      .reduce((s, e) => s + e.event_count, 0);
    return { step, label: FUNNEL_STEP_LABELS[step], events: total, semantic_events: total - suspicious, suspicious_events: suspicious };
  });

  const suspicious_events: SuspiciousEvent[] = events
    .filter(e => isSuspiciousEventName(e.event_name))
    .map(e => ({ event_name: e.event_name, count: e.event_count }))
    .sort((a, b) => b.count - a.count);

  const suspicious_count = suspicious_events.reduce((s, e) => s + e.count, 0);
  const suspicious_share = total_events > 0 ? suspicious_count / total_events : 0;

  const intent_events     = byStep.get("intent")!.reduce((s, e) => s + e.event_count, 0);
  const conversion_events = byStep.get("conversion")!.reduce((s, e) => s + e.event_count, 0);

  const intent_rate           = sessions > 0      ? intent_events / sessions      : null;
  const conversion_rate       = sessions > 0      ? conversion_events / sessions  : null;
  const intent_to_conversion  = intent_events > 0 ? conversion_events / intent_events : null;

  // Biggest absolute drop between consecutive non-zero stages
  let biggest_dropoff: FunnelDropoff | null = null;
  for (let i = 0; i < FUNNEL_STEP_ORDER.length - 1; i++) {
    const from = stages[i];
    const to   = stages[i + 1];
    if (from.events === 0 || to.events === 0) continue;
    const pct = (to.events - from.events) / from.events;
    if (pct < 0 && (biggest_dropoff === null || pct < biggest_dropoff.pct)) {
      biggest_dropoff = { from_step: from.step, to_step: to.step, from_events: from.events, to_events: to.events, pct };
    }
  }

  let health: FunnelIntelligence["health"];
  if (conversion_events === 0) {
    health = "limited";
  } else if (suspicious_share > 0.20 || (intent_to_conversion !== null && intent_to_conversion < 0.08)) {
    health = "attention";
  } else if (conversion_rate !== null && conversion_rate >= 0.05) {
    health = "healthy";
  } else {
    health = "attention";
  }

  return {
    stages, total_events,
    intent_rate, conversion_rate, intent_to_conversion,
    biggest_dropoff,
    suspicious_events, suspicious_share, semantic_coverage: 1 - suspicious_share,
    health,
  };
}

export function fmtFunnelPct(ratio: number | null, decimals = 1): string {
  if (ratio === null) return "—";
  return (ratio * 100).toFixed(decimals).replace(".", ",") + "%";
}
