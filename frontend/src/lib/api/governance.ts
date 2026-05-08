import { createClient } from "@/utils/supabase/server";
import type { ApiQueryFilters } from "@/types/growth";
import type {
  GovernanceEvidence,
  GovernanceEvidenceResponse,
  GovernanceFinding,
  GovernanceFindingsResponse,
  GovernanceRunsResponse,
  GovernanceRun,
  GovernanceSummaryResponse,
  GovernanceSeverity,
} from "@/types/governance";
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

const GOVERNANCE_TABLES = [
  "semantic_governance_runs",
  "semantic_governance_findings",
  "semantic_governance_evidence",
  "data_quality_report",
  "insight_feed",
];

export async function getGovernanceSummary(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GovernanceSummaryResponse> {
  const supabase = await createClient();
  const warnings: string[] = [];

  let runsQuery = supabase
    .from("semantic_governance_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(filters.limit);
  runsQuery = applyRunFilters(runsQuery, filters);

  let findingsQuery = supabase
    .from("semantic_governance_findings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(filters.limit);
  findingsQuery = applyFindingFilters(findingsQuery, filters);

  let dqQuery = supabase
    .from("data_quality_report")
    .select("id,check_name,status,severity,source_platform,details,date_range_start,date_range_end,checked_at")
    .eq("workspace_id", workspaceId)
    .eq("check_category", "semantic_governance")
    .order("checked_at", { ascending: false })
    .limit(200);
  dqQuery = applyFindingFilters(dqQuery, filters);

  let insightsQuery = supabase
    .from("insight_feed")
    .select("id,status,severity,source_tables,insight_type,updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(200);
  insightsQuery = applyDateFilters(insightsQuery, filters);
  if (isSimpleFilterValue(filters.status)) insightsQuery = insightsQuery.eq("status", filters.status);
  if (isSimpleFilterValue(filters.severity)) insightsQuery = insightsQuery.eq("severity", filters.severity);

  const [runs, findings, dataQuality, insights] = await Promise.all([
    readRows<RawRow>(runsQuery, "semantic_governance_runs"),
    readRows<RawRow>(findingsQuery, "semantic_governance_findings"),
    readRows<RawRow>(dqQuery, "data_quality_report"),
    readRows<RawRow>(insightsQuery, "insight_feed"),
  ]);
  warnings.push(...runs.warnings, ...findings.warnings, ...dataQuality.warnings, ...insights.warnings);

  const runRows = runs.rows.map(mapGovernanceRun);
  const findingRows = findings.rows
    .filter((row) => looseJsonMatch(row, filters))
    .map(mapGovernanceFinding);
  const evidence = await readEvidenceForFindings(findingRows.map((row) => row.id), filters.limit);
  warnings.push(...evidence.warnings);

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: GOVERNANCE_TABLES,
    warnings,
    data: {
      latest_run: runRows[0] ?? null,
      runs: {
        total: runRows.length,
        success: runRows.filter((run) => run.status === "success").length,
        error: runRows.filter((run) => run.status === "error").length,
        running: runRows.filter((run) => run.status === "running").length,
      },
      findings: buildFindingsSummary(findingRows),
      evidence: {
        total: evidence.rows.length,
        by_type: countBy(evidence.rows.map((row) => stringValue(row.evidence_type) ?? "unknown")),
      },
      data_quality_shadow: {
        semantic_checks: dataQuality.rows.length,
        warnings: dataQuality.rows.filter((row) => row.status === "warning").length,
        failed: dataQuality.rows.filter((row) => row.status === "failed").length,
      },
      related_insights: {
        total: insights.rows.length,
        high_priority: insights.rows.filter((row) => row.severity === "high" || row.severity === "critical").length,
        by_status: countBy(insights.rows.map((row) => stringValue(row.status) ?? "unknown")),
      },
    },
  });
}

export async function getGovernanceRuns(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GovernanceRunsResponse> {
  const supabase = await createClient();
  let query = supabase
    .from("semantic_governance_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(filters.limit);

  query = applyRunFilters(query, filters);

  const result = await readRows<RawRow>(query, "semantic_governance_runs");
  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["semantic_governance_runs"],
    warnings: result.warnings,
    data: {
      runs: result.rows.map(mapGovernanceRun),
    },
  });
}

export async function getGovernanceFindings(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GovernanceFindingsResponse> {
  const supabase = await createClient();
  let query = supabase
    .from("semantic_governance_findings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(filters.limit);

  query = applyFindingFilters(query, filters);

  const result = await readRows<RawRow>(query, "semantic_governance_findings");
  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["semantic_governance_findings"],
    warnings: result.warnings,
    data: {
      findings: result.rows
        .filter((row) => looseJsonMatch(row, filters))
        .map(mapGovernanceFinding),
    },
  });
}

export async function getGovernanceEvidence(
  workspaceId: string,
  filters: ApiQueryFilters,
): Promise<GovernanceEvidenceResponse> {
  const findingsResponse = await getGovernanceFindings(workspaceId, filters);
  const findings = findingsResponse.data.findings;
  const evidenceResult = await readEvidenceForFindings(
    findings.map((finding) => finding.id),
    filters.limit,
  );
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));

  const evidence = evidenceResult.rows
    .filter((row) => looseJsonMatch(row, filters))
    .map((row) => mapGovernanceEvidence(row, findingById))
    .filter((row): row is GovernanceEvidence => row !== null);

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["semantic_governance_evidence", "semantic_governance_findings"],
    warnings: [...findingsResponse.warnings, ...evidenceResult.warnings],
    data: {
      evidence,
    },
  });
}

async function readEvidenceForFindings(findingIds: string[], limit: number) {
  if (findingIds.length === 0) return { rows: [], warnings: [] };
  const supabase = await createClient();
  const query = supabase
    .from("semantic_governance_evidence")
    .select("*")
    .in("finding_id", findingIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  return readRows<RawRow>(query, "semantic_governance_evidence");
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

function applyRunFilters<T extends {
  eq: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}>(query: T, filters: ApiQueryFilters): T {
  let next = applyDateFilters(query, filters);
  if (isSimpleFilterValue(filters.status)) next = next.eq("status", filters.status);
  return next;
}

function applyFindingFilters<T extends {
  eq: (column: string, value: string) => T;
  gte: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}>(query: T, filters: ApiQueryFilters): T {
  let next = applyDateFilters(query, filters);
  if (isSimpleFilterValue(filters.status)) next = next.eq("status", filters.status);
  if (isSimpleFilterValue(filters.severity)) next = next.eq("severity", filters.severity);
  if (isSimpleFilterValue(filters.check_name)) next = next.eq("check_name", filters.check_name);
  if (isSimpleFilterValue(filters.source)) next = next.eq("source_platform", filters.source);
  return next;
}

function mapGovernanceRun(row: RawRow): GovernanceRun {
  return {
    id: stringValue(row.id) ?? "",
    workspace_id: stringValue(row.workspace_id) ?? "",
    tenant_slug: stringValue(row.tenant_slug) ?? "",
    date_range_start: stringValue(row.date_range_start) ?? "",
    date_range_end: stringValue(row.date_range_end) ?? "",
    started_at: stringValue(row.started_at) ?? "",
    finished_at: stringValue(row.finished_at),
    status: runStatusValue(row.status),
    checks_run: toNumber(row.checks_run),
    findings_count: toNumber(row.findings_count),
    error_message: stringValue(row.error_message),
    created_at: stringValue(row.created_at) ?? "",
  };
}

function mapGovernanceFinding(row: RawRow): GovernanceFinding {
  return {
    id: stringValue(row.id) ?? "",
    run_id: stringValue(row.run_id) ?? "",
    workspace_id: stringValue(row.workspace_id) ?? "",
    check_name: stringValue(row.check_name) ?? "",
    status: findingStatusValue(row.status),
    severity: severityValue(row.severity),
    source_platform: stringValue(row.source_platform) ?? "ga4",
    affected_rows: toNumber(row.affected_rows),
    metric_value: toNullableNumber(row.metric_value),
    threshold_value: toNullableNumber(row.threshold_value),
    details: asRecord(row.details),
    date_range_start: stringValue(row.date_range_start) ?? "",
    date_range_end: stringValue(row.date_range_end) ?? "",
    created_at: stringValue(row.created_at) ?? "",
  };
}

function mapGovernanceEvidence(
  row: RawRow,
  findingById: Map<string, GovernanceFinding>,
): GovernanceEvidence | null {
  const findingId = stringValue(row.finding_id) ?? "";
  const finding = findingById.get(findingId);
  if (!finding) return null;

  return {
    id: stringValue(row.id) ?? "",
    finding_id: findingId,
    evidence_type: stringValue(row.evidence_type) ?? "",
    evidence_data: asRecord(row.evidence_data) ?? {},
    created_at: stringValue(row.created_at) ?? "",
    finding: {
      id: finding.id,
      run_id: finding.run_id,
      check_name: finding.check_name,
      status: finding.status,
      severity: finding.severity,
      source_platform: finding.source_platform,
      date_range_start: finding.date_range_start,
      date_range_end: finding.date_range_end,
    },
  };
}

function buildFindingsSummary(findings: GovernanceFinding[]) {
  return {
    total: findings.length,
    passed: findings.filter((finding) => finding.status === "passed").length,
    warnings: findings.filter((finding) => finding.status === "warning").length,
    failed: findings.filter((finding) => finding.status === "failed").length,
    critical: findings.filter((finding) => finding.severity === "critical" && finding.status !== "passed").length,
    by_check_name: countBy(findings.map((finding) => finding.check_name)),
    by_severity: {
      low: findings.filter((finding) => finding.severity === "low").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      high: findings.filter((finding) => finding.severity === "high").length,
      critical: findings.filter((finding) => finding.severity === "critical").length,
    } satisfies Record<GovernanceSeverity, number>,
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function runStatusValue(value: unknown): "running" | "success" | "error" {
  if (value === "success" || value === "error") return value;
  return "running";
}

function findingStatusValue(value: unknown): "passed" | "warning" | "failed" {
  if (value === "warning" || value === "failed") return value;
  return "passed";
}

function severityValue(value: unknown): "low" | "medium" | "high" | "critical" {
  if (value === "medium" || value === "high" || value === "critical") return value;
  return "low";
}
