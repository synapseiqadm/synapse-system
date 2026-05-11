import { EVENT_FUNNEL_MAP } from "@/lib/measurementConfig";

export type SignalCategory   = "priority" | "risk" | "opportunity" | "tracking";
export type SignalUrgency    = "high" | "medium" | "low";
export type SignalConfidence = "alta" | "média" | "baixa";

export interface DecisionSignal {
  category:    SignalCategory;
  urgency:     SignalUrgency;
  statement:   string;
  direction:   string;
  confidence:  SignalConfidence;
  sourceTypes: string[];
}

export interface Ga4DecisionInput {
  sessions:   number;
  top_events: Array<{ event_name: string; count: number }>;
}

interface MinimalInsight {
  insight_type: string;
  evidence?: Record<string, unknown> | null;
}

function isSuspiciousEventName(name: string): boolean {
  if (EVENT_FUNNEL_MAP[name.toLowerCase()] !== undefined) return false;
  return name !== name.toLowerCase();
}

const CONVERSION_EVENTS = new Set([
  "mentor_signup_success",
  "user_signup_mentor_with_auto_signin",
]);

export function computeDecisionBrief(
  insights: MinimalInsight[],
  ga4: Ga4DecisionInput | null,
): DecisionSignal[] {
  const signals: DecisionSignal[] = [];

  // 1. PRIORITY — zero-conversion waste across campaigns + keywords
  const wasteTypes = [
    "campaign_zero_conversions_with_cost",
    "keyword_zero_conversions_with_cost",
  ];
  const wasteInsights = insights.filter(i => wasteTypes.includes(i.insight_type));
  if (wasteInsights.length > 0) {
    const totalCost = wasteInsights.reduce(
      (sum, i) => sum + (typeof i.evidence?.cost === "number" ? i.evidence.cost : 0),
      0,
    );
    const campaignCount = insights.filter(i => i.insight_type === "campaign_zero_conversions_with_cost").length;
    const keywordCount  = insights.filter(i => i.insight_type === "keyword_zero_conversions_with_cost").length;
    const urgency: SignalUrgency = totalCost > 500 ? "high" : totalCost > 100 ? "medium" : "low";
    const costFmt = totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const parts: string[] = [];
    if (campaignCount > 0) parts.push(`${campaignCount} campanha${campaignCount !== 1 ? "s" : ""}`);
    if (keywordCount > 0)  parts.push(`${keywordCount} keyword${keywordCount !== 1 ? "s" : ""}`);
    signals.push({
      category:    "priority",
      urgency,
      statement:   `${parts.join(" e ")} sem conversões consumiram ${costFmt} no período`,
      direction:   "→ Revisar pausas antes de ampliar verba nessas campanhas",
      confidence:  "alta",
      sourceTypes: wasteTypes,
    });
  }

  // 2. RISK — conversion action awaiting semantic validation
  const riskType = "ads_conversion_action_semantic_review_required";
  if (insights.some(i => i.insight_type === riskType)) {
    signals.push({
      category:    "risk",
      urgency:     "medium",
      statement:   "Ações de conversão aguardam validação semântica — ROAS atual pode não refletir a performance real",
      direction:   "→ Validar ações de conversão antes de usar ROAS como KPI primário",
      confidence:  "alta",
      sourceTypes: [riskType],
    });
  }

  // 3. OPPORTUNITY — high intent rate but low intent-to-conversion
  if (ga4 && ga4.sessions > 0) {
    const formStartCount  = ga4.top_events.find(e => e.event_name.toLowerCase() === "form_start")?.count ?? 0;
    const conversionCount = ga4.top_events
      .filter(e => CONVERSION_EVENTS.has(e.event_name.toLowerCase()))
      .reduce((s, e) => s + e.count, 0);
    const intentRate        = formStartCount / ga4.sessions;
    const intentToConversion = formStartCount > 0 ? conversionCount / formStartCount : null;
    if (intentRate > 0.30 && intentToConversion !== null && intentToConversion < 0.15) {
      const intentPct = `${(intentRate * 100).toFixed(1).replace(".", ",")}%`;
      const convPct   = `${(intentToConversion * 100).toFixed(1).replace(".", ",")}%`;
      signals.push({
        category:    "opportunity",
        urgency:     "medium",
        statement:   `${intentPct} das sessões chegam ao formulário, mas só ${convPct} convertem — gap de funil identificado`,
        direction:   "→ Investigar fricção na etapa formulário → conversão",
        confidence:  "média",
        sourceTypes: [],
      });
    }
  }

  // 4. TRACKING — suspicious event names exceed 15% of total event volume
  if (ga4 && ga4.top_events.length > 0) {
    const totalEvts      = ga4.top_events.reduce((s, e) => s + e.count, 0);
    const suspiciousEvts = ga4.top_events
      .filter(e => isSuspiciousEventName(e.event_name))
      .reduce((s, e) => s + e.count, 0);
    const suspiciousShare = totalEvts > 0 ? suspiciousEvts / totalEvts : 0;
    if (suspiciousShare > 0.15) {
      const pct = `${(suspiciousShare * 100).toFixed(1).replace(".", ",")}%`;
      signals.push({
        category:    "tracking",
        urgency:     "low",
        statement:   `${pct} dos eventos têm nomes não padronizados — classificação de funil parcialmente comprometida`,
        direction:   "→ Revisar nomenclatura de eventos no GTM",
        confidence:  "média",
        sourceTypes: [],
      });
    }
  }

  return signals;
}
