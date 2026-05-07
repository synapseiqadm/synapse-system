import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  // Next.js 16: cookies() is async — must be awaited before use
  const cookieStore = await cookies();

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? process.env.SUPABASE_URL  ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

  return createServerClient(
    supabaseUrl,
    supabaseAnon,
    {
      cookies: {
        // Read a single cookie by name
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // Write one or more cookies (called by Supabase after sign-in/refresh)
        set(name: string, value: string, options: Record<string, unknown>) {
          // set() throws in Server Components — safe to ignore;
          // the Middleware handles persistence for those contexts
          try {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          } catch {}
        },
        // Remove a cookie (called on sign-out)
        remove(name: string, options: Record<string, unknown>) {
          try {
            cookieStore.set(name, "", {
              ...(options as Parameters<typeof cookieStore.set>[2]),
              maxAge: 0,
            });
          } catch {}
        },
      },
    }
  );
}
