// src/lib/segments/resolve.ts
// Slice 5 — the segment resolver. Turns a SegmentRule into a live breakdown
// (total / eligible / excluded-with-reasons + count) and the eligible member ids the
// campaign engine enrolls. It gathers the per-recipient signals the pure engine
// (rules.ts) needs — a materialized member (via source_contact_id), channel consent,
// and suppression — then classifies each contact. Segments are DYNAMIC: this runs on
// read, so a newly-cleaned/materialized contact appears in the right audience with no
// rebuild. No parallel enrollment path — resolveAudience() consumes memberIds.
//
// Consent/DNC are ALSO enforced per-recipient at the dispatcher gate; the exclusions
// here are the pre-send preview so the FSA sees exactly who a campaign will reach.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  matchesRule,
  classifyEligibility,
  SEGMENT_PRESETS,
  type SegmentRule,
  type SegmentContact,
  type SegmentChannel,
  type ExclusionReason,
} from './rules'

const CHUNK = 500
const CANDIDATE_CAP = 5000

export interface SegmentBreakdown {
  total: number
  eligible: number
  excluded: number
  byReason: Record<ExclusionReason, number>
  channel: SegmentChannel
  /** Eligible household_members.id — the enrollment keys (empty on error/none). */
  memberIds: string[]
}

const emptyReasons = (): Record<ExclusionReason, number> => ({ no_household: 0, no_contact_method: 0, no_consent: 0, suppressed: 0, incomplete: 0 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))))
  return out
}

/** Household ids a preset's household signal restricts membership to (null = no restriction). */
async function presetHouseholdIds(db: Db, rule: SegmentRule): Promise<string[] | null> {
  const signal = rule.preset ? SEGMENT_PRESETS[rule.preset].householdSignal : null
  if (!signal) return null
  if (signal === 'cross_sell_gaps') {
    const { data } = await db.from('v_cross_sell_gaps').select('household_id').limit(CANDIDATE_CAP)
    return (data ?? []).map((r: { household_id: string }) => r.household_id)
  }
  const { data } = await db.from('v_conversions_due').select('household_id').eq('is_security', false).limit(CANDIDATE_CAP)
  return (data ?? []).map((r: { household_id: string }) => r.household_id)
}

/** Load candidate contacts that structurally match the rule (DB-side filters + a final pure re-check). */
async function loadCandidates(db: Db, rule: SegmentRule, householdIds: string[] | null): Promise<SegmentContact[]> {
  if (householdIds && householdIds.length === 0) return []
  let q = db
    .from('contacts')
    .select('id, full_name, email, phone, household_id, contact_type, tags, source, state, owner_scope, status')
    .is('deleted_at', null)
    .eq('status', 'active')
    .limit(CANDIDATE_CAP)

  if (rule.contactTypes?.length) q = q.in('contact_type', rule.contactTypes)
  if (rule.states?.length) q = q.in('state', rule.states)
  if (rule.ownerScope) q = q.eq('owner_scope', rule.ownerScope)
  const hasSources = !!rule.sources?.length
  const hasTags = !!rule.tagsAny?.length
  if (hasSources && hasTags) {
    // win-back style: source in list OR tags overlap.
    const srcList = rule.sources!.map((s) => s.replace(/[(),]/g, '')).join(',')
    const tagList = `{${rule.tagsAny!.map((t) => t.replace(/[{}",]/g, '')).join(',')}}`
    q = q.or(`source.in.(${srcList}),tags.cs.${tagList}`)
  } else if (hasSources) {
    q = q.in('source', rule.sources!)
  } else if (hasTags) {
    q = q.overlaps('tags', rule.tagsAny!)
  }
  if (householdIds) q = q.in('household_id', householdIds)

  const { data } = await q
  const rows = (data ?? []) as SegmentContact[]
  // Final authoritative membership check in the pure engine (defends against any
  // filter drift and applies the exact same rule the tests cover).
  return rows.filter((c) => matchesRule(c, rule))
}

/**
 * Resolve a segment to a live eligibility breakdown + the eligible member ids.
 * Degrades to an all-zero breakdown on any failure so a preview never crashes.
 */
export async function resolveSegment(db: Db, rule: SegmentRule): Promise<SegmentBreakdown> {
  const channel = rule.channel ?? 'email'
  const byReason = emptyReasons()
  try {
    const householdIds = await presetHouseholdIds(db, rule)
    const candidates = await loadCandidates(db, rule, householdIds)
    if (candidates.length === 0) return { total: 0, eligible: 0, excluded: 0, byReason, channel, memberIds: [] }

    const contactIds = candidates.map((c) => c.id)

    // Materialized members for these contacts (source_contact_id), with household DNC.
    const memberRows = await inChunks(contactIds, async (chunk) => {
      const { data } = await db
        .from('household_members')
        .select('id, source_contact_id, households!inner(do_not_contact, deleted_at)')
        .in('source_contact_id', chunk)
      return (data ?? []) as unknown as Array<{ id: string; source_contact_id: string; households: { do_not_contact: boolean; deleted_at: string | null } | null }>
    })
    const memberByContact = new Map<string, { memberId: string; doNotContact: boolean }>()
    for (const r of memberRows) {
      if (r.households?.deleted_at) continue
      memberByContact.set(r.source_contact_id, { memberId: r.id, doNotContact: !!r.households?.do_not_contact })
    }

    // Channel consent per member (granted / revoked).
    const memberIds = Array.from(memberByContact.values()).map((v) => v.memberId)
    const consentRows = await inChunks(memberIds, async (chunk) => {
      const { data } = await db.from('consents').select('member_id, status').eq('channel', channel).in('member_id', chunk)
      return (data ?? []) as Array<{ member_id: string; status: string }>
    })
    const consentByMember = new Map(consentRows.map((r) => [r.member_id, r.status]))

    let eligible = 0
    const eligibleMemberIds: string[] = []
    for (const c of candidates) {
      const mem = memberByContact.get(c.id)
      const consent = mem ? consentByMember.get(mem.memberId) : undefined
      const signals = {
        hasMember: !!mem,
        hasConsent: consent === 'granted',
        // Suppression: household do_not_contact OR a revoked consent. (dnc_entries is
        // additionally enforced at the dispatcher gate at send time.)
        suppressed: !!mem?.doNotContact || consent === 'revoked',
      }
      const { eligible: ok, reasons } = classifyEligibility(c, rule, signals)
      if (ok && mem) { eligible++; eligibleMemberIds.push(mem.memberId) }
      else for (const r of reasons) byReason[r]++
    }

    return {
      total: candidates.length,
      eligible,
      excluded: candidates.length - eligible,
      byReason,
      channel,
      memberIds: eligibleMemberIds,
    }
  } catch {
    return { total: 0, eligible: 0, excluded: 0, byReason, channel, memberIds: [] }
  }
}

/** Eligible member ids only — the enrollment keys resolveAudience() feeds the engine. */
export async function segmentMemberIds(db: Db, rule: SegmentRule): Promise<string[]> {
  return (await resolveSegment(db, rule)).memberIds
}
