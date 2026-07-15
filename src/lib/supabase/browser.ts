'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser Supabase client that persists the session in COOKIES (via @supabase/ssr),
 * not localStorage. This is the critical difference from getBrowserDb() in
 * ./client.ts: the middleware and RSC layout guards read the session from cookies
 * (src/middleware.ts, src/lib/auth/session.ts), so the sign-in / MFA flow must use
 * this client for the server side to ever see the authenticated session.
 *
 * Lazy singleton — instantiated on first use inside a client component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBrowserClient(): SupabaseClient<any> {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      '[FSOS] Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required',
    )
  }

  _client = createBrowserClient(url, key)
  return _client
}
