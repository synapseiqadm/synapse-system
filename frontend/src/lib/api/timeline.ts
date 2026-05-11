import type { ApiResponseBase, ApiQueryFilters } from "@/types/growth";

export interface TimelineEvent {
  type: "operational_event" | "sync_run" | "governance_finding" | "kpi_change";
  timestamp: string;
  title: string;
  description?: string;
  details?: Record<string, unknown>;
  actor?: string;
  severity?: "success" | "info" | "warning" | "error" | "critical";
}

export interface KpiDiff {
  metric_name: string;
  value_before: number;
  value_after: number;
  delta: number;
  percentage_change: number;
}

export interface TimelineResponse extends ApiResponseBase {
  data: {
    events: TimelineEvent[];
    kpi_diffs?: KpiDiff[];
    momentum_data?: { // Novo campo para MomentumChartProps
      trend_delta: number | null;
      contextual_labels: string[];
    };
  };
}

export async function getTimeline(workspaceId: string, filters: ApiQueryFilters): Promise<TimelineResponse> {
  const params = new URLSearchParams(filters as unknown as Record<string, string>).toString();
  const res = await fetch(`/api/workspaces/${workspaceId}/timeline?${params}`);
  return res.json();
}