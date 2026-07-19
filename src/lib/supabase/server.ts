import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Anon-key Supabase clients that carry the user's auth cookies, so RLS applies
 * as the authenticated user. Distinct from getDb() (service role, bypasses RLS —
 * used only for server-side writes AFTER an rbac scope assertion, per
 * middleware-auth.md §5). Never instantiate at module level.
 */

function env(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return { url, key }
}

export interface CookieAdapter {
  getAll(): { name: string; value: string }[]
  setAll(cookies: { name: string; value: string; options: CookieOptions }[]): void
}

/**
 * Build a request-scoped anon client from a cookie adapter. Returns null when
 * Supabase is not configured, so callers can degrade to "unauthenticated"
 * instead of crashing the build or a request.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerSupabase(cookies: CookieAdapter): SupabaseClient<any> | null {
  const e = env()
  if (!e) return null
  return createServerClient(e.url, e.key, {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          cookies.setAll(list)
        } catch {
          // RSC render context: cookies are read-only. Safe to ignore; the
          // session is refreshed in middleware where writes are allowed.
        }
      },
    },
  })
}
