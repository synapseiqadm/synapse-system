import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveWorkspace } from "@/lib/resolve-workspace";

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();

    const workspace = await resolveWorkspace(supabase);
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { dbId?: string; status?: string };
    const { dbId, status } = body;

    if (!dbId || !status) {
      return NextResponse.json({ ok: false, error: "Missing dbId or status" }, { status: 400 });
    }
    if (status !== "approved" && status !== "rejected") {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    // Superadmin may be acting on a workspace different from their profile default.
    // Use admin client to bypass RLS for cross-workspace mutations.
    const db = workspace.isSuperadmin ? createAdminClient() : supabase;

    const { error } = await db
      .from("agent_decisions")
      .update({ status })
      .eq("id", dbId)
      .eq("workspace_id", workspace.id);

    if (error) {
      console.error("[agents/action] update error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    console.error("[agents/action] Unexpected error:", err);
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}
