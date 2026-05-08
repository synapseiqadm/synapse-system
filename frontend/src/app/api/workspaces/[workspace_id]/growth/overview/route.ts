import { handleApiRoute, type WorkspaceRouteContext } from "@/lib/api/common";
import { getGrowthOverview } from "@/lib/api/growth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: WorkspaceRouteContext) {
  const { workspace_id } = await context.params;
  return handleApiRoute(workspace_id, new URL(request.url).searchParams, getGrowthOverview);
}
