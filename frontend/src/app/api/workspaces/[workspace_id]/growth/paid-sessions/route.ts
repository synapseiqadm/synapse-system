import { type NextRequest } from "next/server";
import { handleApiRoute, type WorkspaceRouteContext } from "@/lib/api/common";
import { getPaidSessionsQuality } from "@/lib/api/growth";

export async function GET(
  request: NextRequest,
  { params }: WorkspaceRouteContext
) {
  const { workspace_id } = await params;
  return handleApiRoute(workspace_id, request.nextUrl.searchParams, getPaidSessionsQuality);
}