// src/lib/services/agencyDeletion.ts
// Agency partnerships are the aggregate ROOT of FSOS. This service manages removal from
// the directory — either ARCHIVE (soft, recoverable: sets archived_at, keeps everything)
// or PURGE (permanent hard delete).
//
// Deleting an agency row CASCADES to its owned records — agency_owners,
// agency_activation, agency_communication_delegations, commission_splits,
// district_nurture_enrollments, user_agencies, comm_agency_suppressions — and DETACHES
// (ON DELETE SET NULL) the book it referred: households.referring_agency_id,
// contacts.agency_partnership_id, opportunities, commissions, referrals, comm_* and
// (via migration 118) household_policies.agency_partnership_id. So the book (households,
// policies, contacts) SURVIVES a purge; only the partnership record and its own
// sub-records go. Verified against pg_constraint — with migration 118 no FK blocks a purge.
//
// Safety model (mirrors householdDeletion.ts):
//   • A filter-driven op MUST be discriminating (a specific status) — an empty /
//     scope-only filter is refused so a bulk op can never target the whole directory.
//     The UI's "delete all matching" instead sends the concrete ids it resolved client-side.
//   • Targets are resolved first, so the caller can dryRun-preview the exact count.
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

export type AgencyDeletionMode = 'archive' | 'purge'
/** Which live agencies a filter applies to (mirrors the directory's active/archived split). */
export type AgencyScope = 'active' | 'archived' | 'all'

/**
 * A filter over the directory. `status` (e.g. 'producing') is the discriminating criterion;
 * `scope` narrows visibility only and is NOT discriminating (see isDiscriminatingFilter).
 */
export interface AgencyDeletionFilter {
  /** agency_partnerships.status. */
  status?: string | null
  /** active = not archived, archived = archived_at set, all = both. Default active. */
  scope?: AgencyScope
}

/** True when the filter narrows the directory by status — safe to act on. Scope-only is refused. */
export function isDiscriminatingFilter(f: AgencyDeletionFilter | null | undefined): boolean {
  return Boolean(f?.status && String(f.status).trim())
}

/** Normalize a raw filter — trims empties, defaults the scope to 'active'. */
export function normalizeFilter(f: AgencyDeletionFilter | null | undefined): AgencyDeletionFilter {
  const status = (f?.status ?? '').trim()
  const scope: AgencyScope = f?.scope === 'archived' ? 'archived' : f?.scope === 'all' ? 'all' : 'active'
  return { status: status.length ? status : undefined, scope }
}

/** Resolve the concrete, live (non-deleted) agency ids a filter matches. */
export async function resolveFilterAgencyIds(db: Db, raw: AgencyDeletionFilter): Promise<string[]> {
  const f = normalizeFilter(raw)
  const ids: string[] = []
  for (let offset = 0; offset < MAX_TARGETS; offset += PAGE) {
    let q = db.from('agency_partnerships').select('id').is('deleted_at', null)
    if (f.scope === 'active') q = q.is('archived_at', null)
    else if (f.scope === 'archived') q = q.not('archived_at', 'is', null)
    if (f.status) q = q.eq('status', f.status)
    const { data, error } = await q.order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string }[]
    ids.push(...rows.map((r) => r.id))
    if (rows.length < PAGE) break
  }
  return ids
}

/** Keep only ids that are currently live agencies (drops already-deleted / bogus ids). */
export async function filterExistingAgencyIds(db: Db, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const present: string[] = []
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const { data, error } = await db.from('agency_partnerships').select('id').in('id', chunk).is('deleted_at', null)
    if (error) throw new Error(error.message)
    present.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
  }
  return present
}

export type AgencyDeletionResult =
  | { ok: true; count: number; affected: number; mode: AgencyDeletionMode; dryRun: boolean }
  | { ok: false; error: 'no_target' | 'db_error'; message?: string }

/**
 * Resolve + (optionally) archive or permanently delete agencies. Provide EITHER `ids`
 * (explicit selection / a status set the client resolved) OR a discriminating `filter`
 * (a specific status). A non-discriminating filter with no ids returns `no_target`.
 *
 * mode 'archive' sets archived_at (recoverable). mode 'purge' hard-deletes the row (the
 * cascade removes owners/activation/delegations/commission-splits; the book detaches).
 * dryRun resolves the count without changing anything.
 */
export async function deleteAgencies(
  db: Db,
  params: {
    ids?: string[]
    filter?: AgencyDeletionFilter
    mode: AgencyDeletionMode
    actor: string
    dryRun?: boolean
  },
): Promise<AgencyDeletionResult> {
  const { actor, mode, dryRun = false } = params
  try {
    let targetIds: string[]
    let by: 'selection' | 'filter'
    if (params.ids && params.ids.length) {
      targetIds = await filterExistingAgencyIds(db, params.ids)
      by = 'selection'
    } else if (isDiscriminatingFilter(params.filter)) {
      targetIds = await resolveFilterAgencyIds(db, params.filter as AgencyDeletionFilter)
      by = 'filter'
    } else {
      return { ok: false, error: 'no_target', message: 'Select agencies or a status to remove.' }
    }

    if (dryRun) return { ok: true, count: targetIds.length, affected: 0, mode, dryRun: true }
    if (targetIds.length === 0) return { ok: true, count: 0, affected: 0, mode, dryRun: false }

    let affected = 0
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const chunk = targetIds.slice(i, i + CHUNK)
      const { error } =
        mode === 'purge'
          ? await db.from('agency_partnerships').delete().in('id', chunk)
          : await db
              .from('agency_partnerships')
              .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .in('id', chunk)
              .is('deleted_at', null)
      if (error) return { ok: false, error: 'db_error', message: error.message }
      affected += chunk.length
    }

    await writeAudit({
      actor,
      action: mode === 'purge' ? 'entity.deleted' : 'entity.updated',
      entity: 'agency_partnership',
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
