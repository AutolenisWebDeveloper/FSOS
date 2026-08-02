// src/lib/comms/bulk-consent-run.ts
// The "Group Consents" bulk engine (Compliance → Consent). Manage consent for an ENTIRE contact
// group — where a "group" is any `contacts.tags` value — in one operation instead of opening
// each contact by hand. It resolves the group's members by tag and delegates to the SAME
// audited consent-write cores the importer/backfill use (grantConsentForMembers /
// revokeConsentForMembers) — no parallel consent path (§6).
//
// Two directions, two compliance postures:
//   • GRANT is suppression-aware and ADD-ONLY: it seeds consent for members who have none and
//     leaves already-granted alone, but NEVER re-consents someone who opted out (existing
//     revoke / channel DNC / do_not_contact household are skipped and reported). This is the
//     §12/TCPA guarantee — a bulk grant can't override an opt-out. Requires an operator
//     attestation of prior express consent.
//   • REVOKE is the safe direction (revoke IS suppression): it applies to every group member,
//     creating or updating a `revoked` row. Requires an explicit confirmation.
//
// A dry-run previews the resolved population + planned counts before anything is written.
// Thin service — business logic out of the route (§3.1).

import { getDb } from '@/lib/supabase/client'
import { aggregateTagCounts, normalizeTag, type TagCount } from './contact-tag-catalog'
import { grantConsentForMembers, type GrantConsentForMembersResult } from './consent-group-grant-run'
import { revokeConsentForMembers, type RevokeConsentForMembersResult } from './consent-revoke-run'
import type { PopChannel } from './consent-population'

const READ_CHUNK = 300
const CONTACT_PAGE = 1000
// Hard cap on the tag-catalog scan so an unbounded book can't blow the request. Surfaced to the
// operator when hit (never a silent truncation).
const TAG_SCAN_CAP = 50000

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs.filter(Boolean)))

export interface TagCatalog {
  tags: TagCount[]
  /** True if the scan hit TAG_SCAN_CAP and the catalog may be incomplete. */
  capped: boolean
}

/**
 * Distinct `contacts.tags` values across the (non-deleted) book with per-tag contact counts,
 * most-used first — the "existing contact groups" the picker lists. Paginated; caps the scan.
 */
export async function listContactTags(): Promise<TagCatalog> {
  const db = getDb()
  const rows: Array<{ tags?: string[] | null }> = []
  let from = 0
  let capped = false
  for (;;) {
    const { data, error } = await db
      .from('contacts')
      .select('tags')
      .is('deleted_at', null)
      .range(from, from + CONTACT_PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as Array<{ tags?: string[] | null }>
    rows.push(...page)
    if (page.length < CONTACT_PAGE) break
    from += CONTACT_PAGE
    if (rows.length >= TAG_SCAN_CAP) {
      capped = true
      break
    }
  }
  return { tags: aggregateTagCounts(rows), capped }
}

export interface ResolvedTagPopulation {
  /** Non-deleted contacts whose tags overlap the selected tag set. */
  contactsMatched: number
  /** Of those, how many are materialized into a household_member (consent-reachable). */
  membersResolved: number
  /** Matched contacts not yet linked into a household — consent can't be keyed to them yet. */
  contactsWithoutMember: number
  memberIds: string[]
}

/**
 * Resolve the members behind a set of tags: contacts overlapping any selected tag → their
 * materialized members via household_members.source_contact_id. Reads only. Shared by the
 * consent-group backfill (which passes a group's import-tags) and the bulk-tag tool.
 */
export async function resolveContactTagPopulation(tags: string[]): Promise<ResolvedTagPopulation> {
  const db = getDb()
  const wanted = uniq(tags.map(normalizeTag))
  if (wanted.length === 0) {
    return { contactsMatched: 0, membersResolved: 0, contactsWithoutMember: 0, memberIds: [] }
  }

  const contactIds: string[] = []
  {
    const { data, error } = await db
      .from('contacts')
      .select('id')
      .overlaps('tags', wanted)
      .is('deleted_at', null)
    if (error) throw error
    for (const r of (data ?? []) as { id: string }[]) contactIds.push(r.id)
  }
  const uniqueContacts = uniq(contactIds)
  if (uniqueContacts.length === 0) {
    return { contactsMatched: 0, membersResolved: 0, contactsWithoutMember: 0, memberIds: [] }
  }

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

export type BulkConsentAction = 'grant' | 'revoke'

const BULK_SOURCE = 'bulk_group_update'

function tagLabel(tags: string[]): string {
  return uniq(tags.map(normalizeTag)).join(', ')
}

export interface BulkTagConsentOptions {
  tags: string[]
  channels: PopChannel[]
  action: BulkConsentAction
  actor: string
  dryRun?: boolean
}

export interface BulkTagConsentResult {
  action: BulkConsentAction
  tags: string[]
  channels: PopChannel[]
  population: ResolvedTagPopulation
  /** The grant OR revoke report (discriminated by `action`). */
  grant?: GrantConsentForMembersResult
  revoke?: RevokeConsentForMembersResult
}

/**
 * Run a bulk grant or revoke for a tag-defined group. Resolves the population, then delegates to
 * the shared audited core. Grant stays suppression-aware (opt-outs win); revoke applies to all.
 */
export async function runBulkTagConsent(opts: BulkTagConsentOptions): Promise<BulkTagConsentResult> {
  const { tags, channels, action, actor, dryRun } = opts
  const population = await resolveContactTagPopulation(tags)
  const label = tagLabel(tags)
  const auditDiffExtra = { tags: uniq(tags.map(normalizeTag)), action }

  if (action === 'revoke') {
    const revoke = await revokeConsentForMembers({
      memberIds: population.memberIds,
      source: BULK_SOURCE,
      disclosure: `Bulk Group Update — consent revoked for group tag(s): ${label}. Opt-out recorded by the licensed FSA.`,
      channels,
      actor,
      dryRun,
      auditEntity: 'consent_bulk_group_update',
      auditDiffExtra,
    })
    return { action, tags, channels, population, revoke }
  }

  const grant = await grantConsentForMembers({
    memberIds: population.memberIds,
    source: BULK_SOURCE,
    disclosure: `Bulk Group Update — prior express consent asserted by the licensed FSA for group tag(s): ${label}.`,
    channels,
    actor,
    dryRun,
    auditEntity: 'consent_bulk_group_update',
    auditDiffExtra,
  })
  return { action, tags, channels, population, grant }
}
