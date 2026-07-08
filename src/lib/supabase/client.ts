import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton — initialized on first call inside a request handler.
// Module-level instantiation fails at Next.js build time (env vars unavailable).
//
// Note: We intentionally do NOT pass the Database generic to createClient here.
// supabase-js v2's strict generic inference breaks on partial column selects
// (e.g. .select('customer_id').maybeSingle() returns `never` instead of a Pick).
// Route-level types are enforced via explicit `as` casts where needed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: SupabaseClient<any> | null = null

/**
 * Server-side admin client (service role key, bypasses RLS).
 * Call inside request handlers only. Never at module level. Never in client components.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): SupabaseClient<any> {
  if (_db) return _db

  // Accept both the FSOS-native names and the names injected by the official
  // Supabase↔Vercel integration (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), so a
  // reconnected integration doesn't silently break every internal API route.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      '[FSOS] Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ' +
        'SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)'
    )
  }

  _db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return _db
}

/**
 * Browser-side client (anon key, respects RLS).
 * Safe for client components. Lazy-initialized.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browserDb: SupabaseClient<any> | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBrowserDb(): SupabaseClient<any> {
  if (_browserDb) return _browserDb

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      '[FSOS] Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required'
    )
  }

  _browserDb = createClient(url, key)
  return _browserDb
}
