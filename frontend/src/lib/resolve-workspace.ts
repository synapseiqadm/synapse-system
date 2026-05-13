import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/admin";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";
import type { createClient } from "@/utils/supabase/server";

export const WORKSPACE_COOKIE = "synapseiq_workspace";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ResolvedWorkspace = {
  id:           string;
  name:         string;
  slug:         string;
  isSuperadmin: boolean;
};

// Resolves the active workspace for the authenticated user.
// Superadmins: workspace is determined by cookie synapseiq_workspace (falls back to profile default).
// Regular users: workspace is always the one in profiles.workspace_id.
export async function resolveWorkspace(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ResolvedWorkspace | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("workspace_id, role")
    .eq("id", user.id)
    .single();
  if (!profile?.workspace_id) return null;

  if (profile.role === "superadmin") {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get(WORKSPACE_COOKIE)?.value;
    const activeId =
      cookieVal && UUID_RE.test(cookieVal) ? cookieVal : (profile.workspace_id as string);

    // Use service key to bypass RLS — superadmin can read any workspace
    const admin = createAdminClient();
    const { data: ws } = await admin
      .from("workspaces")
      .select("name, slug")
      .eq("id", activeId)
      .single();

    if (!ws) return null;
    return {
      id:           activeId,
      name:         (ws.name as string) ?? DEFAULT_WORKSPACE.name,
      slug:         (ws.slug as string) ?? DEFAULT_WORKSPACE.slug,
      isSuperadmin: true,
    };
  }

  // Regular user — profile workspace, RLS-scoped
  const { data: ws } = await supabase
    .from("workspaces")
    .select("name, slug")
    .eq("id", profile.workspace_id)
    .single();

  return {
    id:           profile.workspace_id as string,
    name:         (ws?.name as string) ?? DEFAULT_WORKSPACE.name,
    slug:         (ws?.slug as string) ?? DEFAULT_WORKSPACE.slug,
    isSuperadmin: false,
  };
}
