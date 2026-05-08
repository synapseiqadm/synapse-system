import { type NextRequest } from "next/server";
import { handleApiRoute, type WorkspaceRouteContext } from "@/lib/api/common";
import { getGovernanceSummary } from "@/lib/api/governance";

export async function GET(
  request: NextRequest,
  { params }: WorkspaceRouteContext
) {
  const { workspace_id } = await params;
  return handleApiRoute(workspace_id, request.nextUrl.searchParams, getGovernanceSummary);
}