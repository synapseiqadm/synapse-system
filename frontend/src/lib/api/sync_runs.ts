export const EXPECTED_SOURCES = [
  "campaign_summary",
  "kpi_cache_daily",
  "keyword_analysis",
] as const;

export type ExpectedSource = (typeof EXPECTED_SOURCES)[number];

export type SyncRun = {
  id: string;
  workspace_id: string;
  source_platform: string;
  data_source: string;
  status: string; // "success" | "error" | "running"
  started_at: string;
  finished_at: string | null;
  rows_loaded: number | null;
  date_range_start: string | null;
  date_range_end: string | null;
  error_message: string | null;
};

export type HealthStatus = "healthy" | "warning" | "error" | "unknown";

export function mapBadgeStatus(
  status: string,
): "success" | "failure" | "running" | "pending" {
  if (status === "error") return "failure";
  if (status === "running") return "running";
  if (status === "success") return "success";
  return "pending";
}

// Returns the last run per expected data_source (runs must be sorted DESC by started_at).
export function latestPerExpectedSource(
  runs: SyncRun[],
): Partial<Record<ExpectedSource, SyncRun>> {
  const result: Partial<Record<ExpectedSource, SyncRun>> = {};
  for (const run of runs) {
    const key = run.data_source as ExpectedSource;
    if (EXPECTED_SOURCES.includes(key) && !result[key]) {
      result[key] = run;
    }
  }
  return result;
}

export function computeHealth(
  latestMap: Partial<Record<ExpectedSource, SyncRun>>,
): HealthStatus {
  const found = EXPECTED_SOURCES.map((s) => latestMap[s]).filter(
    Boolean,
  ) as SyncRun[];
  if (found.length === 0) return "unknown";
  if (found.some((r) => r.status === "error")) return "error";
  if (found.length < EXPECTED_SOURCES.length) return "warning";
  if (found.every((r) => r.status === "success")) return "healthy";
  return "warning";
}

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function runDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
