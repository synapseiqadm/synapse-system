import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  handleApiRoute,
  makeEnvelope,
  readRows,
  type WorkspaceRouteContext,
} from "@/lib/api/common";
import type { ApiQueryFilters } from "@/types/growth";

type Severity = "success" | "info" | "warning" | "error" | "critical";

function severityFromCategory(category: string): Severity {
  if (category === "sync_success") return "success";
  if (category === "sync_error")   return "error";
  if (category === "kpi_anomaly")  return "warning";
  return "info";
}

type RawEvent = Record<string, unknown>;

async function getTimelineEvents(workspaceId: string, filters: ApiQueryFilters) {
  const supabase = await createClient();

  let query = supabase
    .from("operational_events")
    .select("id, event_type, category, title, description, impact_scope, actor, occurred_at")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .limit(filters.limit ?? 50);

  if (filters.date_start) query = query.gte("occurred_at", filters.date_start);
  if (filters.date_end)   query = query.lte("occurred_at", filters.date_end);

  const { rows, warnings } = await readRows<RawEvent>(query, "operational_events");

  const events = rows.map((row) => ({
    type:        "operational_event" as const,
    timestamp:   String(row.occurred_at ?? ""),
    title:       String(row.title ?? `${row.event_type} — ${row.category}`),
    description: row.description != null ? String(row.description) : undefined,
    details:     (row.impact_scope as Record<string, unknown>) ?? undefined,
    actor:       row.actor != null ? String(row.actor) : undefined,
    severity:    severityFromCategory(String(row.category ?? "")),
  }));

  return makeEnvelope({
    workspaceId,
    filters,
    sourceTables: ["operational_events"],
    warnings,
    data: { events },
  });
}

export async function GET(
  request: NextRequest,
  { params }: WorkspaceRouteContext,
) {
  const { workspace_id } = await params;
  return handleApiRoute(workspace_id, request.nextUrl.searchParams, getTimelineEvents);
}
