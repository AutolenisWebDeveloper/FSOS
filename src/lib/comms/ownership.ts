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
    const { data } = await getDb()
      .from('agency_communication_delegations')
      .select(
        'id, status, agency_id, effective_at, expires_at, permitted_campaign_types, permitted_channels, representative_user_id',
      )
      .eq('agency_id', input.agencyId)
      .eq('status', 'ACTIVE')
      .limit(20)
    const rows = (data ?? []) as DelegationRow[]
    const rec =
      (input.senderUserId ? rows.find((r) => r.representative_user_id === input.senderUserId) : undefined) ??
      rows.find((r) => !r.representative_user_id) ??
      rows[0] ??
      null
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
 * enough for retries: a duplicate open review for the same (destination, campaign) is
 * harmless. Best-effort + audited (comms.blocked), never throws into the send path.
 */
export async function enqueueAssignmentReview(input: AssignmentReviewInput): Promise<void> {
  try {
    const db = getDb()
    // Avoid piling duplicate open reviews for the same destination + campaign.
    const { data: existing } = await db
      .from('comm_assignment_reviews')
      .select('id')
      .eq('destination', input.destination)
      .eq('status', 'open')
      .is('campaign_id', input.campaignId ?? null)
      .limit(1)
    if (!Array.isArray(existing) || existing.length === 0) {
      await db.from('comm_assignment_reviews').insert({
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
    }
    await writeAudit({
      actor: 'system',
      action: 'comms.blocked',
      entity: 'comm_assignment_review',
      entityId: input.householdId ?? null,
      diff: { channel: input.channel, destination: input.destination, reason: input.reason },
    })
  } catch {
    /* best-effort — the gate has already blocked the send; the queue is the recovery path */
  }
}
