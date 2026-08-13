// src/lib/services/householdDeletion.ts
// The CRM book (households) is FSOS's single source of truth for contacts. This service
// manages removal from the book — either ARCHIVE (soft, recoverable: sets archived_at,
// keeps every policy / review / FNA plan / enrollment) or PURGE (permanent hard delete).
//
// A household is an aggregate root: deleting the row CASCADES to household_members,
// household_policies, reviews, notes, consents, document_requests, the FNA tables, and
// every campaign enrollment; appointments / cases / opportunities / referrals are
// ON DELETE SET NULL (detached, not destroyed). Both behaviors are DB-enforced, verified
// against pg_constraint — no FK blocks a purge.
//
// Safety model (mirrors contactDeletion.ts):
//   • A filter-driven op MUST be discriminating (a referring agency) — an empty /
//     scope-only filter is refused so a bulk op can never target the whole book by
//     accident. The UI's "delete all matching a saved view + agency" instead sends the
//     concrete ids it already resolved client-side.
//   • Targets are resolved first, so the caller can dryRun-preview the exact count before
//     confirming, and the audit records what changed.
//   • Archive is the default; purge is the guarded, type-to-confirm action.
//
// Authorization is enforced at the route (fsa / super_admin); this service assumes an
// already-authorized actor.

import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from '@/lib/audit/log'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

const PAGE = 1000
const CHUNK = 500
const MAX_TARGETS = 100000

export type HouseholdDeletionMode = 'archive' | 'purge'
/** Which live households a filter applies to (mirrors the book's active/archived split). */
export type HouseholdScope = 'active' | 'archived' | 'all'

/**
 * A filter over the book. `referringAgencyId` is the discriminating criterion; `scope`
 * narrows visibility only and is NOT counted as discriminating (see isDiscriminatingFilter).
 */
export interface HouseholdDeletionFilter {
  /** Agency — households.referring_agency_id. */
  referringAgencyId?: string | null
  /** Visibility: active = not archived, archived = archived_at set, all = both. Default active. */
  scope?: HouseholdScope
}

/** True when the filter narrows the book by agency — safe to act on. Scope-only is refused. */
export function isDiscriminatingFilter(f: HouseholdDeletionFilter | null | undefined): boolean {
  return Boolean(f?.referringAgencyId)
}

/** Normalize a raw filter — trims empties, defaults the scope to 'active'. */
export function normalizeFilter(f: HouseholdDeletionFilter | null | undefined): HouseholdDeletionFilter {
  const agency = (f?.referringAgencyId ?? '').trim()
  const scope: HouseholdScope = f?.scope === 'archived' ? 'archived' : f?.scope === 'all' ? 'all' : 'active'
  return { referringAgencyId: agency.length ? agency : undefined, scope }
}

/** Resolve the concrete, live (non-deleted) household ids a filter matches. */
export async function resolveFilterHouseholdIds(db: Db, raw: HouseholdDeletionFilter): Promise<string[]> {
  const f = normalizeFilter(raw)
  const ids: string[] = []
  for (let offset = 0; offset < MAX_TARGETS; offset += PAGE) {
    let q = db.from('households').select('id').is('deleted_at', null)
    if (f.scope === 'active') q = q.is('archived_at', null)
    else if (f.scope === 'archived') q = q.not('archived_at', 'is', null)
    if (f.referringAgencyId) q = q.eq('referring_agency_id', f.referringAgencyId)
    const { data, error } = await q.order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string }[]
    ids.push(...rows.map((r) => r.id))
    if (rows.length < PAGE) break
  }
  return ids
}

/** Keep only ids that are currently live households (drops already-deleted / bogus ids). */
export async function filterExistingHouseholdIds(db: Db, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const present: string[] = []
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const { data, error } = await db.from('households').select('id').in('id', chunk).is('deleted_at', null)
    if (error) throw new Error(error.message)
    present.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
  }
  return present
}

export type HouseholdDeletionResult =
  | { ok: true; count: number; affected: number; mode: HouseholdDeletionMode; dryRun: boolean }
  | { ok: false; error: 'no_target' | 'db_error'; message?: string }

/**
 * Resolve + (optionally) archive or permanently delete households. Provide EITHER `ids`
 * (explicit selection / a saved-view+agency set the client resolved) OR a discriminating
 * `filter` (a referring agency). A non-discriminating filter with no ids returns
 * `no_target` rather than acting on the whole book.
 *
 * mode 'archive' sets archived_at (recoverable). mode 'purge' hard-deletes the row (the
 * aggregate cascade removes members/policies/reviews/FNA/enrollments). dryRun resolves the
 * count without changing anything.
 */
export async function deleteHouseholds(
  db: Db,
  params: {
    ids?: string[]
    filter?: HouseholdDeletionFilter
    mode: HouseholdDeletionMode
    actor: string
    dryRun?: boolean
  },
): Promise<HouseholdDeletionResult> {
  const { actor, mode, dryRun = false } = params
  try {
    let targetIds: string[]
    let by: 'selection' | 'filter'
    if (params.ids && params.ids.length) {
      targetIds = await filterExistingHouseholdIds(db, params.ids)
      by = 'selection'
    } else if (isDiscriminatingFilter(params.filter)) {
      targetIds = await resolveFilterHouseholdIds(db, params.filter as HouseholdDeletionFilter)
      by = 'filter'
    } else {
      return { ok: false, error: 'no_target', message: 'Select households or an agency to remove.' }
    }

    if (dryRun) return { ok: true, count: targetIds.length, affected: 0, mode, dryRun: true }
    if (targetIds.length === 0) return { ok: true, count: 0, affected: 0, mode, dryRun: false }

    let affected = 0
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const chunk = targetIds.slice(i, i + CHUNK)
      const { error } =
        mode === 'purge'
          ? await db.from('households').delete().in('id', chunk)
          : await db
              .from('households')
              .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .in('id', chunk)
              .is('deleted_at', null)
      if (error) return { ok: false, error: 'db_error', message: error.message }
      affected += chunk.length
    }

    await writeAudit({
      actor,
      action: mode === 'purge' ? 'entity.deleted' : 'entity.updated',
      entity: 'household',
      entityId: by === 'selection' && targetIds.length === 1 ? targetIds[0] : null,
      diff: {
        mode,
        by,
        affected,
        filter: by === 'filter' ? normalizeFilter(params.filter) : undefined,
        sampleIds: targetIds.slice(0, 50),
      },
    })

    return { ok: true, count: targetIds.length, affected, mode, dryRun: false }
  } catch (e) {
    return { ok: false, error: 'db_error', message: e instanceof Error ? e.message : String(e) }
  }
}
