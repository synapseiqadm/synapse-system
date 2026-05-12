import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

async function resolveWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id")
    .eq("id", user.id)
    .single();
  return profile?.workspace_id ? (profile.workspace_id as string) : null;
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();

    const workspaceId = await resolveWorkspace(supabase);
    if (!workspaceId) {
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

    const { error } = await supabase
      .from("agent_decisions")
      .update({ status })
      .eq("id", dbId)
      .eq("workspace_id", workspaceId);

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
