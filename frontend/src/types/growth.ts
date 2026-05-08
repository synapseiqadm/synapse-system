export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export type GrowthStatus = "passed" | "warning" | "failed";
export type GrowthSeverity = "low" | "medium" | "high" | "critical";
export type InsightStatus = "new" | "reviewed" | "dismissed" | "resolved";

export interface ApiQueryFilters {
  date_start?: string;
  date_end?: string;
  environment?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  status?: string;
  severity?: string;
  check_name?: string;
  limit: number;
}

export interface ApiResponseBase {
  ok: true;
  workspace_id: string;
  filters: ApiQueryFilters;
  source_tables: string[];
  generated_at: string;
  warnings: string[];
}

export interface GrowthEventCount {
  event_name: string;
  count: number;
}

export interface GrowthLandingPage {
  page_location: string;
  views: number;
}

export interface Ga4FirstLightSummary {
  id?: string;
  workspace_id: string;
  ga4_dataset: string;
  latest_table: string | null;
  latest_event_date: string | null;
  total_events: number;
  total_users: number;
  sessions: number;
  page_views: number;
  top_events: GrowthEventCount[];
  top_landing_pages: GrowthLandingPage[];
  conversion_events: Record<string, number>;
  source_platform: string | null;
  data_source: string | null;
  is_mock: boolean | null;
  date_range_start: string | null;
  date_range_end: string | null;
  loaded_at: string | null;
  updated_at: string | null;
}

export interface CampaignSummaryContract {
  campaign_id: string | null;
  campaign_name: string | null;
  cost: number;
  conversions: number;
  roas: number;
  source_platform: string | null;
  data_source?: string | null;
  is_mock: boolean | null;
  date_range_start: string | null;
  date_range_end: string | null;
  loaded_at: string | null;
}

export interface KeywordAnalysisContract {
  campaign_id?: string | null;
  campaign_name: string | null;
  keyword: string | null;
  match_type: string | null;
  clicks: number;
  cost: number;
  conversions: number;
  source_platform: string | null;
  data_source?: string | null;
  is_mock: boolean | null;
  date_range_start: string | null;
  date_range_end: string | null;
  loaded_at: string | null;
}

export interface GrowthQualityCheck {
  id: string;
  check_name: string;
  check_category: string;
  status: GrowthStatus;
  severity: GrowthSeverity;
  source_platform: string | null;
  target_table: string | null;
  affected_rows: number;
  metric_value: number | null;
  threshold_value: number | null;
  details: JsonObject | null;
  date_range_start: string | null;
  date_range_end: string | null;
  checked_at: string;
}

export interface GrowthInsightSummary {
  total: number;
  by_status: Record<InsightStatus, number>;
  high_priority: number;
  latest_updated_at: string | null;
}

export interface GrowthOverviewResponse extends ApiResponseBase {
  data: {
    ga4_first_light: Ga4FirstLightSummary | null;
    ads: {
      campaigns: number;
      keywords: number;
      total_cost: number;
      conversions: number;
      average_roas: number;
      top_campaigns: CampaignSummaryContract[];
    };
    quality: {
      checks: number;
      passed: number;
      warnings: number;
      failed: number;
      critical: number;
      latest_checked_at: string | null;
    };
    insights: GrowthInsightSummary;
  };
}

export interface GrowthFunnelEvent {
  event_name: string;
  event_count: number;
  step: "acquisition" | "landing" | "engagement" | "intent" | "conversion";
  is_conversion: boolean;
  date_range_start: string | null;
  date_range_end: string | null;
  updated_at: string | null;
}

export interface GrowthFunnelResponse extends ApiResponseBase {
  data: {
    summary: {
      sessions: number;
      page_views: number;
      conversions: number;
      total_events: number;
    };
    events: GrowthFunnelEvent[];
  };
}

export interface GrowthEventsResponse extends ApiResponseBase {
  data: {
    events: Array<GrowthFunnelEvent & { share_of_events: number | null }>;
    landing_pages: GrowthLandingPage[];
  };
}

export interface PaidSessionsQualityContract {
  id: string;
  check_name: string;
  status: GrowthStatus;
  severity: GrowthSeverity;
  source_platform: string | null;
  paid_sessions: number | null;
  paid_sessions_with_progress: number | null;
  paid_sessions_without_progress: number | null;
  total_paid_views: number | null;
  missing_utm_params: JsonValue | null;
  param_coverage: JsonValue | null;
  funnel_events_checked: JsonValue | null;
  details: JsonObject | null;
  date_range_start: string | null;
  date_range_end: string | null;
  checked_at: string;
}

export interface PaidSessionsQualityResponse extends ApiResponseBase {
  data: {
    checks: PaidSessionsQualityContract[];
  };
}
