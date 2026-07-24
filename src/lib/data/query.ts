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

// The count fn returns PostgREST's exact count (use `.select('id', { count:
// 'exact', head: true })` — no rows transferred, just the count).
type CountFn = (db: SupabaseClient<any>) => PromiseLike<{ count: number | null; error: { message: string } | null }> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Load a COUNT without transferring rows (head:true). Use for dashboard tiles that
 * only need "how many" — avoids fetching up-to-1000 id rows just to take `.length`.
 * Degrades to `fallback` (default 0) on any failure so a widget never crashes.
 */
export async function loadCount(fn: CountFn, fallback = 0): Promise<number> {
  try {
    const { count, error } = await fn(getDb())
    if (error) return fallback
    return count ?? fallback
  } catch {
    return fallback
  }
}

// A range-capable query builder (supabase-js returns one from .from().select()...).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RangeBuilder = { range: (from: number, to: number) => PromiseLike<{ data: any; error: { message: string } | null }> }

/**
 * Load ALL rows of a query by paging past PostgREST's per-request row cap.
 * Fetches in `pageSize` windows via .range() until a short page is returned, so a
 * large book (thousands of policies/contacts/households) is fully loaded rather
 * than silently truncated to the default ~1000. Use for list pages that render
 * or client-filter the full set.
 */
export async function loadAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (db: SupabaseClient<any>) => RangeBuilder,
  opts: { pageSize?: number; max?: number } = {},
): Promise<LoadResult<T[]>> {
  const pageSize = opts.pageSize ?? 1000
  const max = opts.max ?? 100000
  try {
    const db = getDb()
    const all: T[] = []
    for (let offset = 0; offset < max; offset += pageSize) {
      const { data, error } = await build(db).range(offset, offset + pageSize - 1)
      if (error) return { ok: false, kind: 'error', message: error.message }
      const rows = (data ?? []) as T[]
      all.push(...rows)
      if (rows.length < pageSize) break
    }
    return { ok: true, data: all }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

/** The DOB encryption key the app passes to the pgcrypto RPCs (never stored in DB). */
export function dobKey(): string {
  return process.env.DOB_ENCRYPTION_KEY || process.env.FSOS_DOB_KEY || 'fsos-dev-dob-key-change-me'
}

/**
 * Normalize a PostgREST embedded relation to a single row. An embedded relation
 * (e.g. `households(primary_name)`) may deserialize as a single object OR a
 * one-element array depending on the join; this collapses both (and null) to
 * `T | null`, replacing the `Array.isArray(x) ? x[0] : x` idiom that was
 * copy-pasted across ~14 report/route/page files.
 */
export function unwrapOne<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null
  return Array.isArray(rel) ? (rel[0] ?? null) : rel
}
