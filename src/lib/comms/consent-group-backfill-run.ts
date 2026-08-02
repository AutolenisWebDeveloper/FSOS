// src/lib/comms/consent-group-backfill-run.ts
// RETROACTIVE consent-group backfill — seed the prior-express consent the §12 gate requires
// for contacts ALREADY imported into a group, where consent was never seeded at import time
// (the legacy per-group importers, and any pre-consent-group batch, wrote no `consents` rows).
//
// This is NOT a second grant path. It only RESOLVES the existing population — contacts whose
// `contacts.tags` overlap the group's import-tag set (consent-groups.ts `groupImportTags`),
// mapped to their materialized `household_members` (the campaign-targetable member spine) via
// `source_contact_id` — and then delegates to the SAME suppression-aware, idempotent, audited
// runner the importer uses (grantConsentForGroup). So every guarantee still holds:
//   • a later opt-out ALWAYS wins (existing revoke / channel DNC / do_not_contact household);
//   • re-running never duplicates or overwrites (unique(member_id,channel) + ON CONFLICT);
//   • the group's documented disclosure is written verbatim onto every seeded row (§13.9);
//   • the bulk grant is itself one audited event.
//
// The operator must ATTEST at the route (as at import), and a dry-run preview shows the exact
// resolved count + per-reason skips BEFORE any write — the mapping is never a silent guess.
// Thin service: business logic out of the route (CLAUDE.md §3.1).

import { getDb } from '@/lib/supabase/client'
import { groupImportTags, type ConsentGroup } from './consent-groups'
import { grantConsentForGroup, type GrantConsentForGroupResult } from './consent-group-grant-run'
import type { PopChannel } from './consent-population'

const READ_CHUNK = 300

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)))

export interface ResolvedGroupPopulation {
  /** Non-deleted contacts whose tags overlap the group's import-tag set. */
  contactsMatched: number
  /** Of those, how many are materialized into a household_member (campaign-reachable). */
  membersResolved: number
  /** Contacts matched but NOT yet materialized into a member — consent can't be member-keyed
   *  for them until they are (surfaced so the operator knows the gap, not silently dropped). */
  contactsWithoutMember: number
  /** The resolved member ids to seed consent for. */
  memberIds: string[]
}

/**
 * Resolve the already-imported population for a group: tag-matched contacts → their members.
 * Reads only (no writes). A contact with no materialized member contributes to
 * `contactsWithoutMember` but not `memberIds` — consent is member-keyed, so it can't be seeded
 * until the daily materialization (or a manual create) links the contact into the spine.
 */
export async function resolveImportedGroupPopulation(group: ConsentGroup): Promise<ResolvedGroupPopulation> {
  const db = getDb()
  const tags = groupImportTags(group)

  // Contacts whose tags overlap the group's import-tag set (active, non-deleted).
  const contactIds: string[] = []
  {
    const { data, error } = await db
      .from('contacts')
      .select('id')
      .overlaps('tags', tags)
      .is('deleted_at', null)
    if (error) throw error
    for (const r of (data ?? []) as { id: string }[]) contactIds.push(r.id)
  }
  const uniqueContacts = uniq(contactIds)

  if (uniqueContacts.length === 0) {
    return { contactsMatched: 0, membersResolved: 0, contactsWithoutMember: 0, memberIds: [] }
  }

  // Map contacts → materialized members via household_members.source_contact_id.
  const memberIds: string[] = []
  const linkedContactIds = new Set<string>()
  for (const ids of chunk(uniqueContacts, READ_CHUNK)) {
    const { data, error } = await db
      .from('household_members')
      .select('id, source_contact_id')
      .in('source_contact_id', ids)
    if (error) throw error
    for (const r of (data ?? []) as { id: string; source_contact_id: string | null }[]) {
      if (!r.id) continue
      memberIds.push(r.id)
      if (r.source_contact_id) linkedContactIds.add(r.source_contact_id)
    }
  }
  const uniqueMembers = uniq(memberIds)

  return {
    contactsMatched: uniqueContacts.length,
    membersResolved: uniqueMembers.length,
    contactsWithoutMember: uniqueContacts.filter((id) => !linkedContactIds.has(id)).length,
    memberIds: uniqueMembers,
  }
}

export interface BackfillGroupConsentOptions {
  group: ConsentGroup
  channels: PopChannel[]
  actor: string
  /** Preview only — resolve + plan, write nothing. */
  dryRun?: boolean
}

export interface BackfillGroupConsentResult extends GrantConsentForGroupResult {
  population: ResolvedGroupPopulation
}

/**
 * Backfill consent for a group's already-imported population. Resolves the members by tag, then
 * runs the shared grant (dry-run for preview, real for commit). Returns the grant report plus
 * the resolved-population breakdown so the UI can show "N contacts → M members reachable".
 */
export async function backfillGroupConsent(opts: BackfillGroupConsentOptions): Promise<BackfillGroupConsentResult> {
  const { group, channels, actor, dryRun } = opts
  const population = await resolveImportedGroupPopulation(group)
  const report = await grantConsentForGroup({
    memberIds: population.memberIds,
    group,
    channels,
    actor,
    dryRun,
  })
  return { ...report, population }
}
