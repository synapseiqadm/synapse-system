import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

// GET /api/admin/workspaces — lists all workspaces; only accessible to superadmin.
export async function GET() {
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

    const admin = createAdminClient();
    const { data: workspaces, error } = await admin
      .from("workspaces")
      .select("id, name, slug")
      .order("name");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }

    return NextResponse.json({ ok: true, workspaces: workspaces ?? [] });
  } catch (err) {
    console.error("[admin/workspaces]", err);
    return NextResponse.json({ ok: false, error: "Unexpected error" }, { status: 500 });
  }
}
