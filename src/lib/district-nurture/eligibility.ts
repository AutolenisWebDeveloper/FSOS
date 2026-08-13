// src/lib/district-nurture/eligibility.ts
// PURE eligibility gate for the District Agent FS Nurture Campaign (ADR-038).
//
// Recomputed before enrollment AND before every touch (the same decision function both
// paths call), so an agent who opts out, whose agency terminates, or who starts a live
// conversation stops receiving proactive touches on the next tick. SELF-CONTAINED (no
// imports) for the isolated-compile unit test.
//
// AUDIENCE = the Farmers district agent (agency owner). There is no client household or
// securities policy here, so the client firewall/staleness model does not apply; the
// gate is: reachable + agency not terminated + not opted out + not mid-conversation +
// not already enrolled + not in re-enroll cooldown. The send path re-derives DNC/consent
// and the securities firewall server-side regardless (defence in depth).

export type NurtureEligibilityReason =
  | 'not_reachable'
  | 'agency_terminated'
  | 'opted_out'
  | 'in_conversation'
  | 'duplicate_active'
  | 'in_cooldown'

export interface NurtureEligibilityInput {
  /** At least one contact channel (email or phone) resolves. */
  reachable: boolean
  /** agency_partnerships.status — 'terminated' is excluded. */
  agencyStatus: string
  /** DNC / opt-out recorded for this agent's channels. */
  optedOut: boolean
  /** A live conversation is open with this agent (ADR-018 pause). */
  inActiveConversation: boolean
  /** A prior live enrollment already exists (one per campaign per agent). */
  priorEnrollmentActive: boolean
  /** Exited recently and still inside reenroll_cooldown_days. */
  cooldownActive: boolean
}

export interface NurtureEligibilityResult {
  eligible: boolean
  reasons: NurtureEligibilityReason[]
}

/**
 * Firewall/opt-out first, then reachability, then the campaign guards. `eligible` is
 * exactly "no blocking reason". Order is stable so tests can assert precedence.
 */
export function evaluateNurtureEligibility(input: NurtureEligibilityInput): NurtureEligibilityResult {
  const reasons: NurtureEligibilityReason[] = []

  if (input.optedOut) reasons.push('opted_out')
  if (input.agencyStatus === 'terminated') reasons.push('agency_terminated')
  if (!input.reachable) reasons.push('not_reachable')
  if (input.inActiveConversation) reasons.push('in_conversation')
  if (input.priorEnrollmentActive) reasons.push('duplicate_active')
  if (input.cooldownActive) reasons.push('in_cooldown')

  return { eligible: reasons.length === 0, reasons }
}

/** Reasons a manual override may waive at enrollment time (staleness-like guards only). */
export const OVERRIDABLE_REASONS: readonly NurtureEligibilityReason[] = ['in_cooldown']

export type RecheckOutcome = 'suppressed' | 'paused_for_conversation' | 'exited'

/**
 * Map a per-touch recheck's blocking reasons to what the tick does to the enrollment.
 * A live conversation is a temporary PAUSE (resumes when the conversation closes); an
 * opt-out is a compliance SUPPRESSION; anything else is a terminal EXIT.
 */
export function classifyRecheckOutcome(reasons: readonly string[]): RecheckOutcome {
  if (reasons.includes('opted_out')) return 'suppressed'
  const terminal = ['agency_terminated', 'not_reachable', 'duplicate_active']
  const hasTerminal = reasons.some((r) => terminal.includes(r))
  if (reasons.includes('in_conversation') && !hasTerminal) return 'paused_for_conversation'
  return 'exited'
}
