// src/lib/data/query.ts
// A thin, RSC-safe read wrapper. Every P0 list/detail page fetches server-side via
// the service-role client AFTER its portal layout has gated the role. This helper
// normalizes the three outcomes a page must render distinctly (archetype DoD):
//   • ok            → real data (empty array is a valid "empty state")
//   • not_configured→ Supabase env not set (503-style notice, not a crash)
//   • error         → query/runtime failure (error state + retry)
// so no page ever throws an opaque 500 during render.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getDb, ConfigError } from '@/lib/supabase/client'

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_configured' | 'error'; message: string }

// The query fn's data shape is intentionally `unknown`: supabase-js's builder
// generics over-infer on partial selects, so we cast the result to the caller's T.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryFn = (db: SupabaseClient<any>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

export async function load<T>(fn: QueryFn, fallback: T): Promise<LoadResult<T>> {
  try {
    const db = getDb()
    const { data, error } = await fn(db)
    if (error) return { ok: false, kind: 'error', message: error.message }
    return { ok: true, data: (data ?? fallback) as T }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/** The DOB encryption key the app passes to the pgcrypto RPCs (never stored in DB). */
export function dobKey(): string {
  return process.env.DOB_ENCRYPTION_KEY || process.env.FSOS_DOB_KEY || 'fsos-dev-dob-key-change-me'
}
