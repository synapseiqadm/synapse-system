/**
 * Static mirror of backend/governance/semantic_registry.yml (v1.0 / SynapseIQ v1.3.1).
 * Single source of truth for check labels, business impact, and treatment rules
 * consumed by frontend components and future AI agents.
 *
 * Rule: never hardcode check labels or requiresClientValidation in components.
 * Always resolve through getCheckLabel() / isReviewRequired().
 */

export interface CheckMetadata {
  label: string;
  category: string;
  severityDefault: string;
  sourcePlatform: string;
  businessImpact: string;
  recommendedAction: string;
  uiGroup: string;
  canGenerateInsight: boolean;
  requiresClientValidation: boolean;
}

export const SEMANTIC_REGISTRY: Record<string, CheckMetadata> = {

  // Check L
  ga4_ads_overlap_insufficient: {
    label: "Sobreposição GA4–Ads Insuficiente",
    category: "semantic_governance",
    severityDefault: "warning",
    sourcePlatform: "ga4+google_ads",
    businessImpact:
      "Attribution validation between GA4 and Ads cannot be completed. Conversion overlap metrics may be inaccurate or based on a partial sample.",
    recommendedAction:
      "Ensure GA4 data export to BigQuery is active and that sync windows for GA4 and Ads overlap by at least the configured minimum days. Check BigQuery export schedule and Airbyte sync status.",
    uiGroup: "data_quality",
    canGenerateInsight: true,
    requiresClientValidation: false,
  },

  // Check M
  ga4_conversion_registry_mismatch: {
    label: "Eventos de Conversão Não Registrados",
    category: "semantic_governance",
    severityDefault: "warning",
    sourcePlatform: "ga4",
    businessImpact:
      "Conversion tracking gaps are present. The business may be missing conversion events in GA4, or the registry contains stale event names that no longer fire.",
    recommendedAction:
      "Verify that canonical conversion events are correctly implemented in the GA4 tracking setup. Check for event naming changes in GTM or the app. Update the registry if event names have been renamed.",
    uiGroup: "conversion_quality",
    canGenerateInsight: true,
    requiresClientValidation: true,
  },

  // Check N
  ads_conversion_action_not_in_registry: {
    label: "Ação de Conversão Fora do Registro",
    category: "semantic_governance",
    severityDefault: "warning",
    sourcePlatform: "google_ads",
    businessImpact:
      "Unregistered conversion actions may inflate or distort ROAS and conversion reporting. Actions without registry entries cannot be validated against GA4 events, creating an attribution blind spot.",
    recommendedAction:
      "Add the unregistered conversion action to the tenant measurement config under ads_only_conversion_actions or canonical_events. Set requires_client_validation: true until the mapping is confirmed.",
    uiGroup: "conversion_quality",
    canGenerateInsight: true,
    requiresClientValidation: true,
  },

  // Check O
  ads_conversion_action_semantic_review_required: {
    label: "Ação de Conversão em Revisão Semântica",
    category: "semantic_governance",
    severityDefault: "warning",
    sourcePlatform: "google_ads",
    businessImpact:
      "Using unvalidated conversion actions as primary KPIs can lead to misleading ROAS calculations and incorrect optimization signals sent to Google Ads Smart Bidding.",
    recommendedAction:
      "Review each flagged conversion action with the client. Confirm which action represents the canonical business conversion. Update business_status to 'validated' in the registry once confirmed. Do not use as primary KPI until validated.",
    uiGroup: "conversion_quality",
    canGenerateInsight: true,
    requiresClientValidation: true,
  },

  // Check P
  ga4_non_production_traffic_detected: {
    label: "Tráfego Não-Produção Detectado",
    category: "semantic_governance",
    severityDefault: "warning",
    sourcePlatform: "ga4",
    businessImpact:
      "Non-production sessions in paid traffic data inflate session counts, distort funnel progression rates, and can incorrectly signal conversion events from internal testing.",
    recommendedAction:
      "Implement GA4 filters or IP exclusions to prevent non-production traffic from being recorded in the production GA4 property. Add environment exclusion rules in GTM. Verify that internal testing uses a separate GA4 property or debug mode that doesn't persist to production tables.",
    uiGroup: "traffic_quality",
    canGenerateInsight: false,
    requiresClientValidation: false,
  },

  // Check Q
  ga4_suspicious_event_names_detected: {
    label: "Nomes de Eventos Suspeitos",
    category: "semantic_governance",
    severityDefault: "low",
    sourcePlatform: "ga4",
    businessImpact:
      "Generic event names make funnel analysis unreliable and prevent meaningful semantic classification. They may mask real conversion events by polluting event counts.",
    recommendedAction:
      "Review the suspicious events list in the measurement config and decide whether to rename, deprecate, or reclassify each event. Work with the tracking team to implement semantically meaningful event names following the GA4 naming convention (verb_noun pattern, e.g. form_submit).",
    uiGroup: "data_quality",
    canGenerateInsight: false,
    requiresClientValidation: false,
  },

  // Check R
  paid_sessions_without_funnel_progress: {
    label: "Sessões Pagas sem Avanço no Funil",
    category: "paid_sessions_quality",
    severityDefault: "warning",
    sourcePlatform: "ga4",
    businessImpact:
      "High percentage of paid sessions without funnel progress indicates landing page-level friction, audience mismatch, or tracking gaps in intermediate funnel events. Directly impacts attribution quality and Smart Bidding signal reliability.",
    recommendedAction:
      "Investigate landing pages with the highest paid session drop-off. Verify intermediate funnel events (engagement, intent) are correctly tracked. Consider adding micro-conversion events at key engagement points (scroll depth, video play, form interaction).",
    uiGroup: "funnel_quality",
    canGenerateInsight: true,
    requiresClientValidation: false,
  },

  // Check S
  utm_campaign_empty_in_paid_urls: {
    label: "UTM Campaign Ausente em URLs Pagas",
    category: "paid_sessions_quality",
    severityDefault: "warning",
    sourcePlatform: "ga4",
    businessImpact:
      "Missing utm_campaign breaks campaign-level attribution in GA4 and prevents accurate ROAS calculation per campaign in reporting tools. Sessions appear as unattributed or lumped under a generic campaign.",
    recommendedAction:
      "Audit Google Ads final URL templates and ensure utm_campaign is included in all ad destination URLs. Use ValueTrack parameters ({campaign}) to populate utm_campaign automatically. Verify in Google Ads URL Templates at account and campaign level.",
    uiGroup: "attribution_quality",
    canGenerateInsight: true,
    requiresClientValidation: false,
  },
};

/** Returns the canonical UI label for a check, falling back to the raw check_name. */
export function getCheckLabel(checkName: string): string {
  return SEMANTIC_REGISTRY[checkName]?.label ?? checkName;
}

/** Returns true if the check requires client validation before acting on findings. */
export function isReviewRequired(checkName: string): boolean {
  return SEMANTIC_REGISTRY[checkName]?.requiresClientValidation ?? false;
}
