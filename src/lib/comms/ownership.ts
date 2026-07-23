// src/lib/comms/ownership.ts
// Slice 1 — Ownership resolution + delegation (DB-backed resolvers).
//
// FSOS is the system of record for WHO a message is on behalf of and WHO actually
// sent it (master build instruction §6). This module resolves that authoritatively
// from the aggregate-root spine at send time and decides delegation via the pure
// core (delegation.ts). Two guarantees it upholds:
//
//   • If ownership cannot be confidently resolved → the caller must NOT send; the
//     record is routed to the assignment-review queue (enqueueAssignmentReview) and
//     the gate blocks on step `ownership` (§6).
//   • On-behalf-of authority is checked FRESH (never trusted from an enrollment
//     snapshot): resolveDelegation loads the current record + supplies `now` to the
//     pure decision. Failure fails CLOSED (§16.4) — never send on an unverifiable
//     delegation.
//
// No securities substance is ever read or stored here (firewall §4.1). No GHL surface
// is touched (§0.A) — all reads are native spine tables.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { evaluateDelegation, type DelegationRecord, type DelegationDecision } from './delegation'

export interface DelegationResolveInput {
  /** The agency the FSA is acting on behalf of. */
  agencyId: string
  channel: 'sms' | 'email'
  campaignType?: string | null
  /** The FSA/team member auth user actually sending (prefers a sender-scoped delegation). */
  senderUserId?: string | null
  /** The agency the contact belongs to (no cross-agency contamination). */
  contactAgencyId?: string | null
}

interface DelegationRow extends DelegationRecord {
  id: string
  representative_user_id: string | null
}

/**
 * Load the most-relevant ACTIVE delegation for this agency + representative and run the
 * pure decision. Prefers a delegation scoped to THIS sender, else an agency-wide one.
 * Fails CLOSED: any lookup error → INVALID (never send on an unverifiable delegation).
 */
export async function resolveDelegation(
  input: DelegationResolveInput,
): Promise<DelegationDecision & { delegationId?: string | null }> {
  try {
    // Deterministic selection (PostgREST does not guarantee row order): prefer a
    // delegation scoped to THIS sender, else an agency-wide one (null representative),
    // else any active — each query ordered created_at desc, limit 1.
    const cols =
      'id, status, agency_id, effective_at, expires_at, permitted_campaign_types, permitted_channels, representative_user_id'
    const activeQuery = () =>
      getDb()
        .from('agency_communication_delegations')
        .select(cols)
        .eq('agency_id', input.agencyId)
        .eq('status', 'ACTIVE')

    // Every query checks `error` and throws into the fail-closed catch below — a lookup
    // failure must never fall through to a broader record and incorrectly ALLOW a send.
    let rec: DelegationRow | null = null
    if (input.senderUserId) {
      const { data, error } = await activeQuery()
        .eq('representative_user_id', input.senderUserId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      rec = ((data ?? [])[0] as DelegationRow) ?? null
    }
    if (!rec) {
      const { data, error } = await activeQuery()
        .is('representative_user_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      rec = ((data ?? [])[0] as DelegationRow) ?? null
    }
    if (!rec) {
      const { data, error } = await activeQuery().order('created_at', { ascending: false }).limit(1)
      if (error) throw error
      rec = ((data ?? [])[0] as DelegationRow) ?? null
    }
    const decision = evaluateDelegation(rec, {
      now: new Date().toISOString(),
      channel: input.channel,
      campaignType: input.campaignType ?? null,
      contactAgencyId: input.contactAgencyId ?? null,
    })
    return { ...decision, delegationId: rec?.id ?? null }
  } catch {
    return { valid: false, reason: 'Delegation could not be verified (fail-closed).', delegationId: null }
  }
}

export interface OwnershipSnapshot {
  representedAgencyId: string | null
  representedAgencyOwnerId: string | null
  representedAgentId: string | null
  contactOwnerId: string | null
  bookOfBusinessRef: string | null
}

export interface OwnershipResolveInput {
  channel: 'sms' | 'email'
  destination: string
  memberId?: string | null
  householdId?: string | null
  agencyId?: string | null
  campaignId?: string | null
  /**
   * When true, this is an on-behalf-of send that REQUIRES a resolved represented agency
   * + agency owner; a missing link makes ownership UNRESOLVED (routes to review).
   */
  requireAgencyOwner?: boolean
}

export interface OwnershipResolution {
  resolved: boolean
  conflict?: string
  ownership: OwnershipSnapshot
}

/**
 * Resolve the full ownership chain for a send from the spine. Maps to EXISTING columns
 * (households.referring_agency_id / owner_scope, agency_owners) — no parallel ownership
 * key is introduced (master build instruction §0 / ADR-013). Fails CLOSED on lookup
 * error and on a required-but-missing agency owner.
 */
export async function resolveOwnershipForSend(input: OwnershipResolveInput): Promise<OwnershipResolution> {
  const ownership: OwnershipSnapshot = {
    representedAgencyId: input.agencyId ?? null,
    representedAgencyOwnerId: null,
    representedAgentId: null,
    contactOwnerId: null,
    bookOfBusinessRef: null,
  }
  try {
    const db = getDb()
    if (input.householdId) {
      const { data: hh } = await db
        .from('households')
        .select('referring_agency_id, owner_scope')
        .eq('id', input.householdId)
        .maybeSingle()
      ownership.representedAgencyId = ownership.representedAgencyId ?? hh?.referring_agency_id ?? null
      ownership.bookOfBusinessRef = hh?.owner_scope ?? null
      ownership.contactOwnerId = hh?.owner_scope ?? null
    }
    if (ownership.representedAgencyId) {
      const { data: owner } = await db
        .from('agency_owners')
        .select('id')
        .eq('agency_id', ownership.representedAgencyId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      ownership.representedAgencyOwnerId = owner?.id ?? null
      ownership.representedAgentId = owner?.id ?? null
    }
  } catch {
    return { resolved: false, conflict: 'Ownership lookup failed (fail-closed).', ownership }
  }

  if (input.requireAgencyOwner) {
    if (!ownership.representedAgencyId) {
      return {
        resolved: false,
        conflict: 'No represented agency on the household — cannot send on behalf of an agency owner.',
        ownership,
      }
    }
    if (!ownership.representedAgencyOwnerId) {
      return { resolved: false, conflict: 'Represented agency has no agency owner on record.', ownership }
    }
  }
  return { resolved: true, ownership }
}

export interface AssignmentReviewInput {
  channel: 'sms' | 'email'
  destination: string
  memberId?: string | null
  householdId?: string | null
  agencyId?: string | null
  campaignId?: string | null
  reason: string
  conflict?: Record<string, unknown>
}

/**
 * Route an unresolvable-ownership record to the assignment-review queue (§6). Idempotent
 * enough for retries: a duplicate open review for the same (channel, destination, campaign)
 * is harmless. Best-effort + audited (comms.blocked), never throws into the send path.
 */
export async function enqueueAssignmentReview(input: AssignmentReviewInput): Promise<void> {
  try {
    const db = getDb()
    // Avoid piling duplicate open reviews for the same (channel, destination, campaign) —
    // the queue is routed/deduped by channel + destination, so an SMS review must not
    // collide with an email one. Ordered so the chosen existing row is deterministic.
    const { data: existing } = await db
      .from('comm_assignment_reviews')
      .select('id')
      .eq('channel', input.channel)
      .eq('destination', input.destination)
      .eq('status', 'open')
      .is('campaign_id', input.campaignId ?? null)
      .order('created_at', { ascending: false })
      .limit(1)
    let reviewId: string | null = Array.isArray(existing) && existing.length > 0 ? existing[0].id : null
    if (!reviewId) {
      const { data: inserted, error: insertErr } = await db
        .from('comm_assignment_reviews')
        .insert({
          channel: input.channel,
          destination: input.destination,
          member_id: input.memberId ?? null,
          household_id: input.householdId ?? null,
          agency_id: input.agencyId ?? null,
          campaign_id: input.campaignId ?? null,
          reason: input.reason,
          conflict: input.conflict ?? {},
          status: 'open',
        })
        .select('id')
        .maybeSingle()
      // If the insert failed OR returned no id, do NOT write a misleading audit row with a
      // null entity id — bail into the catch so the failure is a no-op, not a false record.
      // (getDb() is the service-role client, so a failure here is a constraint/transport
      // error, not RLS.)
      if (insertErr || !inserted?.id) {
        throw insertErr ?? new Error('assignment-review insert returned no id')
      }
      reviewId = inserted.id
    }
    // Audit linkage points at the review row itself (not the household) so the specific
    // enqueued item is traceable; the household is preserved in the diff for context.
    await writeAudit({
      actor: 'system',
      action: 'comms.blocked',
      entity: 'comm_assignment_review',
      entityId: reviewId,
      diff: {
        channel: input.channel,
        destination: input.destination,
        reason: input.reason,
        household_id: input.householdId ?? null,
      },
    })
  } catch {
    /* best-effort — the gate has already blocked the send; the queue is the recovery path */
  }
}
