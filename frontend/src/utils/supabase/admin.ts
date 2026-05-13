import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-only: uses service key to bypass RLS.
// Never import this in client components or expose SUPABASE_SERVICE_KEY to the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!key) throw new Error("SUPABASE_SERVICE_KEY not configured");
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}
