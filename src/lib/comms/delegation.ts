// src/lib/comms/delegation.ts
// Slice 1 — Delegated agency-communication authority (DECISION CORE, PURE).
//
// FSOS models that a licensed FSA (e.g. Markist Athelus) may communicate ON BEHALF
// OF an agency owner. Before any such send, the communications gate must confirm the
// FSA holds an ACTIVE, in-scope delegation for that agency (master build instruction
// §7). This module is the pure decision — no DB, no clock — so it is unit-testable
// offline (tests/comms-delegation.test.mjs) exactly like gate.ts. The DB-backed
// resolver (ownership.ts) loads the record + supplies `now`, then calls this.
//
// A failed decision is a HARD compliance block (gate step `delegation`, escalate=true):
// block, pause the enrollment, create an exception, preserve in audit (§7). Absence of
// a delegation context means the send is NOT on-behalf-of anyone (direct FSA / human /
// transactional) and this check does not apply — that gate step defaults permissive.

export type DelegationStatus = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REVOKED'

export interface DelegationRecord {
  status: DelegationStatus
  /** The agency this delegation authorizes acting on behalf of. */
  agency_id: string
  /** ISO timestamp the delegation becomes effective (null = always effective). */
  effective_at: string | null
  /** ISO timestamp the delegation expires (null = open-ended). */
  expires_at: string | null
  /** Permitted campaign types; null/empty = all types permitted. */
  permitted_campaign_types: string[] | null
  /** Permitted channels; null/empty = all channels permitted. */
  permitted_channels: string[] | null
}

export interface DelegationCheck {
  /** ISO "now" supplied by the caller (never read the clock in a pure fn). */
  now: string
  channel: 'sms' | 'email'
  /** The campaign/message type this send belongs to (null = uncategorized). */
  campaignType?: string | null
  /**
   * The agency the CONTACT belongs to, resolved by the ownership layer. When present it
   * MUST equal the delegation's agency_id (no cross-agency contamination). When null,
   * the contact↔agency binding is validated elsewhere (the ownership resolver) and this
   * check judges only status / window / type / channel scope.
   */
  contactAgencyId?: string | null
}

export interface DelegationDecision {
  valid: boolean
  reason?: string
}

const VALID = (): DelegationDecision => ({ valid: true })
const INVALID = (reason: string): DelegationDecision => ({ valid: false, reason })

/**
 * Decide whether an on-behalf-of send is authorized by this delegation. First failing
 * rule wins. Order: existence → status → effective → expiry → agency binding → campaign
 * type → channel.
 */
export function evaluateDelegation(
  delegation: DelegationRecord | null | undefined,
  check: DelegationCheck,
): DelegationDecision {
  if (!delegation) return INVALID('No active delegation on file for this agency owner.')

  if (delegation.status !== 'ACTIVE') {
    return INVALID(`Delegation status is ${delegation.status}, not ACTIVE.`)
  }

  const now = Date.parse(check.now)
  if (delegation.effective_at && Date.parse(delegation.effective_at) > now) {
    return INVALID('Delegation is not yet effective.')
  }
  if (delegation.expires_at && Date.parse(delegation.expires_at) <= now) {
    return INVALID('Delegation has EXPIRED.')
  }

  // No cross-agency contamination: a resolved contact-agency must match the delegation.
  if (check.contactAgencyId && check.contactAgencyId !== delegation.agency_id) {
    return INVALID('Contact does not belong to the delegated agency.')
  }

  const types = delegation.permitted_campaign_types
  if (types && types.length > 0 && check.campaignType && !types.includes(check.campaignType)) {
    return INVALID(`Campaign type "${check.campaignType}" is not permitted by this delegation.`)
  }

  const channels = delegation.permitted_channels
  if (channels && channels.length > 0 && !channels.includes(check.channel)) {
    return INVALID(`Channel "${check.channel}" is not permitted by this delegation.`)
  }

  return VALID()
}
