import type { ApiQueryFilters, ApiResponseBase, JsonObject, JsonValue } from "./growth";

export type GovernanceRunStatus = "running" | "success" | "error";
export type GovernanceFindingStatus = "passed" | "warning" | "failed";
export type GovernanceSeverity = "low" | "medium" | "high" | "critical";

export interface GovernanceRun {
  id: string;
  workspace_id: string;
  tenant_slug: string;
  date_range_start: string;
  date_range_end: string;
  started_at: string;
  finished_at: string | null;
  status: GovernanceRunStatus;
  checks_run: number;
  findings_count: number;
  error_message: string | null;
  created_at: string;
}

export interface GovernanceFinding {
  id: string;
  run_id: string;
  workspace_id: string;
  check_name: string;
  status: GovernanceFindingStatus;
  severity: GovernanceSeverity;
  source_platform: string;
  affected_rows: number;
  metric_value: number | null;
  threshold_value: number | null;
  details: JsonObject | null;
  date_range_start: string;
  date_range_end: string;
  created_at: string;
}

export interface GovernanceEvidence {
  id: string;
  finding_id: string;
  evidence_type: string;
  evidence_data: JsonObject;
  created_at: string;
  finding: Pick<
    GovernanceFinding,
    "id" | "run_id" | "check_name" | "status" | "severity" | "source_platform" | "date_range_start" | "date_range_end"
  >;
}

export interface GovernanceSummaryResponse extends ApiResponseBase {
  filters: ApiQueryFilters;
  data: {
    latest_run: GovernanceRun | null;
    runs: {
      total: number;
      success: number;
      error: number;
      running: number;
    };
    findings: {
      total: number;
      passed: number;
      warnings: number;
      failed: number;
      critical: number;
      by_check_name: Record<string, number>;
      by_severity: Record<GovernanceSeverity, number>;
    };
    evidence: {
      total: number;
      by_type: Record<string, number>;
    };
    data_quality_shadow: {
      semantic_checks: number;
      warnings: number;
      failed: number;
    };
    related_insights: {
      total: number;
      high_priority: number;
      by_status: Record<string, number>;
    };
  };
}

export interface GovernanceRunsResponse extends ApiResponseBase {
  data: {
    runs: GovernanceRun[];
  };
}

export interface GovernanceFindingsResponse extends ApiResponseBase {
  data: {
    findings: GovernanceFinding[];
  };
}

export interface GovernanceEvidenceResponse extends ApiResponseBase {
  data: {
    evidence: GovernanceEvidence[];
  };
}

export interface SemanticCoverageContract {
  check_name: string;
  status: GovernanceFindingStatus;
  severity: GovernanceSeverity;
  affected_rows: number;
  unregistered_ga4_events: JsonValue | null;
  unregistered_ads_actions: JsonValue | null;
  registered_ads_actions: JsonValue | null;
  flagged_for_review: JsonValue | null;
  suspicious_events: JsonValue | null;
}
