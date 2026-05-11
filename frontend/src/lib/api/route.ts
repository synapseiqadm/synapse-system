import { NextRequest } from "next/server";
import { handleApiRoute } from "@/lib/api/common";

// Stub — getOperationalTimeline will be implemented when the backend
// timeline_engine module is available as a TypeScript-compatible API.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspace_id: string }> },
) {
  const { workspace_id } = await params;
  const searchParams = req.nextUrl.searchParams;

  return handleApiRoute(workspace_id, searchParams, async () => ({ events: [] }));
}
