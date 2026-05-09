import { createClient } from "@/utils/supabase/server";
import type {
  ApiQueryFilters,
  CampaignSummaryContract,
  Ga4FirstLightSummary,
  GrowthEventCount,
  GrowthEventsResponse,
  GrowthFunnelEvent,
  GrowthFunnelResponse,
  GrowthInsightSummary,
  GrowthLandingPage,
  GrowthOverviewResponse,
  GrowthQualityCheck,
  KeywordAnalysisContract,
  PaidSessionsQualityContract,
  PaidSessionsQualityResponse,
} from "@/types/growth";
import {
  asRecord,
  isSimpleFilterValue,
  looseJsonMatch,
  makeEnvelope,
  readRows,
  toNullableNumber,
  toNumber,
} from "./common";

type RawRow = Record<string, unknown>;

const GROWTH_OVERVIEW_TABLES = [
  "ga4_first_light_summary",
  "campaign_summary",
  "keyword_analysis",
  "data_quality_report",
  "insight_feed",
];

const PAID_SESSION_CHECKS = [
  "paid_sessions_without_funnel_progress",
  "utm_campaign_empty_in_paid_urls",
];

export async function getGrowthOverview(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GrowthOverviewResponse> {
  const supabase = await createClient();
  const warnings: string[] = [];

  let ga4Query = supabase
    .from("ga4_first_light_summary")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1);
  ga4Query = applyDateFilters(ga4Query, filters);
  if (isSimpleFilterValue(filters.source)) {
    ga4Query = ga4Query.eq("source_platform", filters.source);
  }

  let campaignQuery = supabase
    .from("campaign_summary")
    .select("campaign_id,campaign_name,cost,conversions,roas,source_platform,data_source,is_mock,date_range_start,date_range_end,loaded_at")
    .eq("workspace_id", workspaceId)
    .order("cost", { ascending: false })
    .limit(filters.limit);
  campaignQuery = applyDateFilters(campaignQuery, filters);
  if (isSimpleFilterValue(filters.source)) {
    campaignQuery = campaignQuery.eq("source_platform", filters.source);
  }
  if (filters.campaign) {
    campaignQuery = campaignQuery.ilike("campaign_name", `%${filters.campaign}%`);
  }

  let keywordQuery = supabase
    .from("keyword_analysis")
    .select("campaign_id,campaign_name,keyword,match_type,clicks,cost,conversions,source_platform,data_source,is_mock,date_range_start,date_range_end,loaded_at")
    .eq("workspace_id", workspaceId)
    .order("conversions", { ascending: false })
    .limit(filters.limit);
  keywordQuery = applyDateFilters(keywordQuery, filters);
  if (isSimpleFilterValue(filters.source)) {
    keywordQuery = keywordQuery.eq("source_platform", filters.source);
  }
  if (filters.campaign) {
    keywordQuery = keywordQuery.ilike("campaign_name", `%${filters.campaign}%`);
  }

  let qualityQuery = supabase
    .from("data_quality_report")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("checked_at", { ascending: false })
    .limit(200);
  qualityQuery = applyDateFilters(qualityQuery, filters);
  qualityQuery = applyQualityFilters(qualityQuery, filters);

  let insightsQuery = supabase
    .from("insight_feed")
    .select("id,status,severity,updated_at,created_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(200);
  insightsQuery = applyDateFilters(insightsQuery, filters);
  if (isSimpleFilterValue(filters.status)) {
    insightsQuery = insightsQuery.eq("status", filters.status);
  }
  if (isSimpleFilterValue(filters.severity)) {
    insightsQuery = insightsQuery.eq("severity", filters.severity);
  }

  const [ga4, campaigns, keywords, quality, insights] = await Promise.all([
    readRows<RawRow>(ga4Query, "ga4_first_light_summary"),
    readRows<RawRow>(campaignQuery, "campaign_summary"),
    readRows<RawRow>(keywordQuery, "keyword_analysis"),
    readRows<RawRow>(qualityQuery, "data_quality_report"),
    readRows<RawRow>(insightsQuery, "insight_feed"),
  ]);
  warnings.push(...ga4.warnings, ...campaigns.warnings, ...keywords.warnings, ...quality.warnings, ...insights.warnings);

  const campaignRows = campaigns.rows.map(mapCampaignSummary);
  const keywordRows = keywords.rows.map(mapKeywordAnalysis);
  const latestChecks = latestChecksByName(quality.rows.map(mapQualityCheck));
  const ga4FirstLight = ga4.rows[0] ? mapGa4FirstLight(ga4.rows[0]) : null;

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: GROWTH_OVERVIEW_TABLES,
    warnings,
    data: {
      ga4_first_light: ga4FirstLight,
      ads: {
        campaigns: campaignRows.length,
        keywords: keywordRows.length,
        total_cost: sum(campaignRows, "cost"),
        conversions: sum(campaignRows, "conversions"),
        average_roas: average(campaignRows.map((row) => row.roas)),
        top_campaigns: campaignRows.slice(0, 10),
      },
      quality: buildQualitySummary(latestChecks),
      insights: buildInsightSummary(insights.rows),
    },
  });
}

export async function getGrowthFunnel(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GrowthFunnelResponse> {
  const { summaries, warnings } = await readGa4Summaries(workspaceId, filters);
  const events = aggregateFunnelEvents(summaries.flatMap(summaryToFunnelEvents));

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["ga4_first_light_summary", "docs/sql/mart_growth_funnel_events.sql"],
    warnings,
    data: {
      summary: {
        sessions: sum(summaries, "sessions"),
        page_views: sum(summaries, "page_views"),
        conversions: events
          .filter((event) => event.is_conversion)
          .reduce((total, event) => total + event.event_count, 0),
        total_events: sum(summaries, "total_events"),
      },
      events,
    },
  });
}

export async function getGrowthEvents(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GrowthEventsResponse> {
  const { summaries, warnings } = await readGa4Summaries(workspaceId, filters);
  const totalEvents = sum(summaries, "total_events");
  const events = aggregateFunnelEvents(summaries.flatMap(summaryToFunnelEvents)).map((event) => ({
    ...event,
    share_of_events: totalEvents > 0 ? Number((event.event_count / totalEvents).toFixed(4)) : null,
  }));
  const landingPages = aggregateLandingPages(summaries.flatMap((s) => s.top_landing_pages));

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["ga4_first_light_summary", "docs/sql/mart_growth_funnel_events.sql"],
    warnings,
    data: {
      events,
      landing_pages: landingPages,
    },
  });
}

export async function getPaidSessionsQuality(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<PaidSessionsQualityResponse> {
  const supabase = await createClient();

  let query = supabase
    .from("data_quality_report")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("check_category", "semantic_governance")
    .in("check_name", filters.check_name ? [filters.check_name] : PAID_SESSION_CHECKS)
    .order("checked_at", { ascending: false })
    .limit(filters.limit);

  query = applyDateFilters(query, filters);
  query = applyQualityFilters(query, filters);

  const result = await readRows<RawRow>(query, "data_quality_report");
  const checks = result.rows
    .filter((row) => looseJsonMatch(row, filters))
    .map(mapPaidSessionsQuality);

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["data_quality_report", "docs/sql/mart_paid_sessions_quality.sql"],
    warnings: result.warnings,
    data: {
      checks,
    },
  });
}

async function readGa4Summaries(workspaceId: string, filters: ApiQueryFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("ga4_first_light_summary")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(filters.limit);

  query = applyDateFilters(query, filters);
  if (isSimpleFilterValue(filters.source)) {
    query = query.eq("source_platform", filters.source);
  }

  const result = await readRows<RawRow>(query, "ga4_first_light_summary");
  return {
    summaries: result.rows.map(mapGa4FirstLight),
    warnings: result.warnings,
  };
}

function applyDateFilters<T extends {
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}>(query: T, filters: ApiQueryFilters): T {
  let next = query;
  if (filters.date_start) next = next.gte("date_range_start", filters.date_start);
  if (filters.date_end) next = next.lte("date_range_end", filters.date_end);
  return next;
}

function applyQualityFilters<T extends {
  eq: (column: string, value: string) => T;
}>(query: T, filters: ApiQueryFilters): T {
  let next = query;
  if (isSimpleFilterValue(filters.source)) next = next.eq("source_platform", filters.source);
  if (isSimpleFilterValue(filters.status)) next = next.eq("status", filters.status);
  if (isSimpleFilterValue(filters.severity)) next = next.eq("severity", filters.severity);
  if (isSimpleFilterValue(filters.check_name)) next = next.eq("check_name", filters.check_name);
  return next;
}

function mapGa4FirstLight(row: RawRow): Ga4FirstLightSummary {
  return {
    id: stringValue(row.id) ?? undefined,
    workspace_id: stringValue(row.workspace_id) ?? "",
    ga4_dataset: stringValue(row.ga4_dataset) ?? "",
    latest_table: stringValue(row.latest_table) ?? stringValue(row.latest_event_table),
    latest_event_date: stringValue(row.latest_event_date),
    total_events: toNumber(row.total_events),
    total_users: toNumber(row.total_users),
    sessions: toNumber(row.sessions),
    page_views: toNumber(row.page_views),
    top_events: mapEventCounts(row.top_events),
    top_landing_pages: mapLandingPages(row.top_landing_pages),
    conversion_events: mapConversionEvents(row.conversion_events),
    source_platform: stringValue(row.source_platform),
    data_source: stringValue(row.data_source),
    is_mock: booleanValue(row.is_mock),
    date_range_start: stringValue(row.date_range_start),
    date_range_end: stringValue(row.date_range_end),
    loaded_at: stringValue(row.loaded_at),
    updated_at: stringValue(row.updated_at),
  };
}

function mapCampaignSummary(row: RawRow): CampaignSummaryContract {
  return {
    campaign_id: stringValue(row.campaign_id),
    campaign_name: stringValue(row.campaign_name),
    cost: toNumber(row.cost),
    conversions: toNumber(row.conversions),
    roas: toNumber(row.roas),
    source_platform: stringValue(row.source_platform),
    data_source: stringValue(row.data_source),
    is_mock: booleanValue(row.is_mock),
    date_range_start: stringValue(row.date_range_start),
    date_range_end: stringValue(row.date_range_end),
    loaded_at: stringValue(row.loaded_at),
  };
}

function mapKeywordAnalysis(row: RawRow): KeywordAnalysisContract {
  return {
    campaign_id: stringValue(row.campaign_id),
    campaign_name: stringValue(row.campaign_name),
    keyword: stringValue(row.keyword),
    match_type: stringValue(row.match_type),
    clicks: toNumber(row.clicks),
    cost: toNumber(row.cost),
    conversions: toNumber(row.conversions),
    source_platform: stringValue(row.source_platform),
    data_source: stringValue(row.data_source),
    is_mock: booleanValue(row.is_mock),
    date_range_start: stringValue(row.date_range_start),
    date_range_end: stringValue(row.date_range_end),
    loaded_at: stringValue(row.loaded_at),
  };
}

function mapQualityCheck(row: RawRow): GrowthQualityCheck {
  return {
    id: stringValue(row.id) ?? "",
    check_name: stringValue(row.check_name) ?? "",
    check_category: stringValue(row.check_category) ?? "",
    status: statusValue(row.status),
    severity: severityValue(row.severity),
    source_platform: stringValue(row.source_platform),
    target_table: stringValue(row.target_table),
    affected_rows: toNumber(row.affected_rows),
    metric_value: toNullableNumber(row.metric_value),
    threshold_value: toNullableNumber(row.threshold_value),
    details: asRecord(row.details),
    date_range_start: stringValue(row.date_range_start),
    date_range_end: stringValue(row.date_range_end),
    checked_at: stringValue(row.checked_at) ?? "",
  };
}

function mapPaidSessionsQuality(row: RawRow): PaidSessionsQualityContract {
  const details = asRecord(row.details);
  return {
    id: stringValue(row.id) ?? "",
    check_name: stringValue(row.check_name) ?? "",
    status: statusValue(row.status),
    severity: severityValue(row.severity),
    source_platform: stringValue(row.source_platform),
    paid_sessions: toNullableNumber(details?.paid_sessions),
    paid_sessions_with_progress: toNullableNumber(details?.paid_sessions_with_progress ?? details?.with_progress),
    paid_sessions_without_progress: toNullableNumber(details?.paid_sessions_without_progress),
    total_paid_views: toNullableNumber(details?.total_paid_views),
    missing_utm_params: jsonValue(details?.missing_params),
    param_coverage: jsonValue(details?.param_coverage),
    funnel_events_checked: jsonValue(details?.funnel_events_checked),
    details,
    date_range_start: stringValue(row.date_range_start),
    date_range_end: stringValue(row.date_range_end),
    checked_at: stringValue(row.checked_at) ?? "",
  };
}

function aggregateFunnelEvents(events: GrowthFunnelEvent[]): GrowthFunnelEvent[] {
  const map = new Map<string, GrowthFunnelEvent>();
  for (const ev of events) {
    const existing = map.get(ev.event_name);
    if (existing) {
      map.set(ev.event_name, { ...existing, event_count: existing.event_count + ev.event_count });
    } else {
      map.set(ev.event_name, { ...ev });
    }
  }
  return [...map.values()];
}

function aggregateLandingPages(pages: GrowthLandingPage[]): GrowthLandingPage[] {
  const map = new Map<string, number>();
  for (const page of pages) {
    map.set(page.page_location, (map.get(page.page_location) ?? 0) + page.views);
  }
  return [...map.entries()].map(([page_location, views]) => ({ page_location, views }));
}

function summaryToFunnelEvents(summary: Ga4FirstLightSummary): GrowthFunnelEvent[] {
  return summary.top_events.map((event) => {
    const isConversion = summary.conversion_events[event.event_name] > 0;
    return {
      event_name: event.event_name,
      event_count: event.count,
      step: classifyFunnelStep(event.event_name, isConversion),
      is_conversion: isConversion,
      date_range_start: summary.date_range_start,
      date_range_end: summary.date_range_end,
      updated_at: summary.updated_at,
    };
  });
}

function classifyFunnelStep(eventName: string, isConversion: boolean): GrowthFunnelEvent["step"] {
  const name = eventName.toLowerCase();
  if (isConversion) return "conversion";
  if (name === "session_start" || name === "first_visit") return "acquisition";
  if (name === "page_view") return "landing";
  if (/(lead|signup|sign_up|submit|criar|premium|purchase|checkout|conversion)/.test(name)) {
    return "intent";
  }
  return "engagement";
}

function mapEventCounts(value: unknown): GrowthEventCount[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      event_name: stringValue(item.event_name) ?? "",
      count: toNumber(item.count),
    }))
    .filter((item) => item.event_name);
}

function mapLandingPages(value: unknown): GrowthLandingPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      page_location: stringValue(item.page_location) ?? "",
      views: toNumber(item.views),
    }))
    .filter((item) => item.page_location);
}

function mapConversionEvents(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).map(([key, count]) => [key, toNumber(count)]),
  );
}

function latestChecksByName(checks: GrowthQualityCheck[]): GrowthQualityCheck[] {
  const byName = new Map<string, GrowthQualityCheck>();
  for (const check of checks) {
    const current = byName.get(check.check_name);
    if (!current || check.checked_at > current.checked_at) byName.set(check.check_name, check);
  }
  return [...byName.values()];
}

function buildQualitySummary(checks: GrowthQualityCheck[]) {
  return {
    checks: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warnings: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
    critical: checks.filter((check) => check.severity === "critical" && check.status !== "passed").length,
    latest_checked_at: maxString(checks.map((check) => check.checked_at)),
  };
}

function buildInsightSummary(rows: RawRow[]): GrowthInsightSummary {
  const byStatus = {
    new: 0,
    reviewed: 0,
    dismissed: 0,
    resolved: 0,
  };
  for (const row of rows) {
    const status = stringValue(row.status);
    if (status === "new" || status === "reviewed" || status === "dismissed" || status === "resolved") {
      byStatus[status] += 1;
    }
  }

  return {
    total: rows.length,
    by_status: byStatus,
    high_priority: rows.filter((row) => row.severity === "high" || row.severity === "critical").length,
    latest_updated_at: maxString(rows.map((row) => stringValue(row.updated_at) ?? stringValue(row.created_at) ?? "")),
  };
}

function sum<T>(rows: T[], key: keyof T): number {
  return rows.reduce((total, row) => total + toNumber(row[key]), 0);
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Number((valid.reduce((total, value) => total + value, 0) / valid.length).toFixed(2));
}

function maxString(values: string[]): string | null {
  const valid = values.filter(Boolean).sort();
  return valid.at(-1) ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function statusValue(value: unknown): "passed" | "warning" | "failed" {
  return value === "warning" || value === "failed" ? value : "passed";
}

function severityValue(value: unknown): "low" | "medium" | "high" | "critical" {
  if (value === "medium" || value === "high" || value === "critical") return value;
  return "low";
}

function jsonValue(value: unknown) {
  if (value === undefined) return null;
  return value;
}
