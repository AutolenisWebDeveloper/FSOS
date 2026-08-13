// src/lib/services/contactDeletion.ts
// Contact Center — PERMANENT (hard) deletion of contacts, individually, by explicit
// multi-selection, or in bulk by CAMPAIGN (origin `source`), AGENCY
// (`agency_partnership_id`), or GROUP (`tags`). Distinct from the archive/soft-delete
// path (status='archived' / deleted_at): this removes the row outright.
//
// Safety model:
//   • A filter-driven delete MUST carry at least one discriminating criterion
//     (agency / campaign / group / type). Status alone is not discriminating — it
//     would match nearly the whole book — so a status-only filter is refused. This
//     is the guard against an accidental "delete everything".
//   • Every hard delete resolves the concrete target ids first, so the caller can
//     preview the exact count (dryRun) before confirming, and the audit records what
//     was removed.
//   • Deletes run in chunks; all FKs into contacts(id) are ON DELETE SET NULL
//     (household_members.source_contact_id, appointments.contact_id, opportunities,
//     agency_owners, campaign staging rows), so removing a contact detaches those
//     references without cascading into households or the aggregate spine.
//
// Authorization is enforced at the route (fsa / super_admin); this service assumes an
// already-authorized actor and focuses on correct, bounded, audited removal.

import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit } from '@/lib/audit/log'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

const PAGE = 1000
const DELETE_CHUNK = 500
const MAX_TARGETS = 100000

/** Which visibility a filter-driven delete applies to (mirrors the list's Active/Archived view). */
export type DeletionStatusScope = 'active' | 'archived' | 'all'

/**
 * A campaign/agency/group filter over the contacts book. All present criteria are ANDed;
 * `tag` matches when the contact carries that tag. `status` scopes visibility only and is
 * NOT counted as a discriminating criterion (see isDiscriminatingFilter).
 */
export interface ContactDeletionFilter {
  /** Agency — contacts.agency_partnership_id. */
  agencyPartnershipId?: string | null
  /** Campaign — contacts.source (origin stream). */
  source?: string | null
  /** Group — a single tag the contact must carry (contacts.tags). */
  tag?: string | null
  /** contacts.contact_type. */
  contactType?: string | null
  /** Visibility scope; defaults to 'active'. */
  status?: DeletionStatusScope
}

/**
 * True when the filter narrows the book by campaign, agency, group, or type — i.e. it is
 * safe to act on. A status-only (or empty) filter is NOT discriminating and must be refused
 * by callers so a bulk delete can never silently target the entire book.
 */
export function isDiscriminatingFilter(f: ContactDeletionFilter | null | undefined): boolean {
  if (!f) return false
  return Boolean(f.agencyPartnershipId || f.source || f.tag || f.contactType)
}

/** Normalize a raw filter — trims empties to undefined so the query builder stays clean. */
export function normalizeFilter(f: ContactDeletionFilter | null | undefined): ContactDeletionFilter {
  const trim = (v?: string | null) => {
    const s = (v ?? '').trim()
    return s.length ? s : undefined
  }
  const status: DeletionStatusScope = f?.status === 'archived' ? 'archived' : f?.status === 'all' ? 'all' : 'active'
  return {
    agencyPartnershipId: trim(f?.agencyPartnershipId),
    source: trim(f?.source),
    tag: trim(f?.tag),
    contactType: trim(f?.contactType),
    status,
  }
}

/** Resolve the concrete, live (non-deleted) contact ids a filter matches. */
export async function resolveFilterContactIds(db: Db, raw: ContactDeletionFilter): Promise<string[]> {
  const f = normalizeFilter(raw)
  const ids: string[] = []
  for (let offset = 0; offset < MAX_TARGETS; offset += PAGE) {
    let q = db.from('contacts').select('id').is('deleted_at', null)
    if (f.status === 'active') q = q.eq('status', 'active')
    else if (f.status === 'archived') q = q.eq('status', 'archived')
    if (f.agencyPartnershipId) q = q.eq('agency_partnership_id', f.agencyPartnershipId)
    if (f.source) q = q.eq('source', f.source)
    if (f.contactType) q = q.eq('contact_type', f.contactType)
    if (f.tag) q = q.contains('tags', [f.tag])
    const { data, error } = await q.order('id', { ascending: true }).range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { id: string }[]
    ids.push(...rows.map((r) => r.id))
    if (rows.length < PAGE) break
  }
  return ids
}

/** Keep only the ids that currently exist as live contacts (drops already-deleted / bogus ids). */
export async function filterExistingContactIds(db: Db, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const present: string[] = []
  for (let i = 0; i < unique.length; i += DELETE_CHUNK) {
    const chunk = unique.slice(i, i + DELETE_CHUNK)
    const { data, error } = await db.from('contacts').select('id').in('id', chunk).is('deleted_at', null)
    if (error) throw new Error(error.message)
    present.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
  }
  return present
}

export type PurgeResult =
  | { ok: true; count: number; deleted: number; dryRun: boolean }
  | { ok: false; error: 'no_target' | 'db_error'; message?: string }

/**
 * Resolve + (optionally) permanently delete contacts. Provide EITHER `ids` (explicit
 * selection / a single contact) OR a discriminating `filter` (campaign/agency/group/type).
 * A non-discriminating filter with no ids returns `no_target` rather than deleting the book.
 *
 * dryRun resolves the target count without deleting — used to preview "this will delete N
 * contacts" before the operator confirms.
 */
export async function purgeContacts(
  db: Db,
  params: { ids?: string[]; filter?: ContactDeletionFilter; actor: string; dryRun?: boolean },
): Promise<PurgeResult> {
  const { actor, dryRun = false } = params
  try {
    // Resolve the concrete target set.
    let targetIds: string[]
    let by: 'selection' | 'filter'
    if (params.ids && params.ids.length) {
      targetIds = await filterExistingContactIds(db, params.ids)
      by = 'selection'
    } else if (isDiscriminatingFilter(params.filter)) {
      targetIds = await resolveFilterContactIds(db, params.filter as ContactDeletionFilter)
      by = 'filter'
    } else {
      // No explicit ids and no discriminating filter — refuse rather than mass-delete.
      return { ok: false, error: 'no_target', message: 'Select contacts or a campaign/agency/group to delete.' }
    }

    if (dryRun) return { ok: true, count: targetIds.length, deleted: 0, dryRun: true }
    if (targetIds.length === 0) return { ok: true, count: 0, deleted: 0, dryRun: false }

    // Chunked hard delete.
    let deleted = 0
    for (let i = 0; i < targetIds.length; i += DELETE_CHUNK) {
      const chunk = targetIds.slice(i, i + DELETE_CHUNK)
      const { error } = await db.from('contacts').delete().in('id', chunk)
      if (error) return { ok: false, error: 'db_error', message: error.message }
      deleted += chunk.length
    }

    // One summary audit entry (not one-per-row: a campaign purge can span thousands).
    await writeAudit({
      actor,
      action: 'entity.deleted',
      entity: 'contact',
      entityId: by === 'selection' && targetIds.length === 1 ? targetIds[0] : null,
      diff: {
        mode: 'purge',
        by,
        deleted,
        filter: by === 'filter' ? normalizeFilter(params.filter) : undefined,
        sampleIds: targetIds.slice(0, 50),
      },
    })

    return { ok: true, count: targetIds.length, deleted, dryRun: false }
  } catch (e) {
    return { ok: false, error: 'db_error', message: e instanceof Error ? e.message : String(e) }
  }
}
