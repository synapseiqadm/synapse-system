import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/resolve-workspace";
import { cookies } from "next/headers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// POST /api/workspaces/switch — sets the active workspace cookie for superadmin.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "superadmin") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json() as { workspace_id?: string };
    const wsId = body.workspace_id?.trim();
    if (!wsId || !UUID_RE.test(wsId)) {
      return NextResponse.json({ ok: false, error: "Invalid workspace_id" }, { status: 400 });
    }

    const cookieStore = await cookies();
    cookieStore.set(WORKSPACE_COOKIE, wsId, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return NextResponse.json({ ok: true, workspace_id: wsId });
  } catch (err) {
    console.error("[workspaces/switch]", err);
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}
