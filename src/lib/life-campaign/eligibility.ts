// src/lib/life-campaign/eligibility.ts
// The Life Conversion Campaign eligibility gate, PURE (no DB/clock). Both the enrollment
// service and the per-touch tick call this, because eligibility must be recomputed before
// enrollment AND before every scheduled touch (owner-approved Checkpoint 1, 2026-07-31).
//
// Active Opportunity Ownership: an active CRM term_conversion opportunity outranks campaign
// automation. Stage vocabulary mirrors termconversion.ts / originate.ts so the campaign and
// the auto-originator agree on what "open" and "terminal" mean:
//   • Closed Won  = 'placed_issued'  → permanent exclusion.
//   • Terminal-lost = 'lost' | 'cancelled' → re-eligible only after the configurable cooldown.
//   • Anything else (prospect/fact_find/quoted_proposed/application/underwriting_suitability…)
//     = OPEN → ineligible while it exists; the advisor owns the relationship.

export const CLOSED_WON_STAGES = ['placed_issued'] as const
export const TERMINAL_LOST_STAGES = ['lost', 'cancelled'] as const

export type EligibilityReason =
  | 'securities_excluded'
  | 'opted_out'
  | 'closed_won'
  | 'active_opportunity'
  | 'cooldown'
  | 'duplicate_active'
  | 'no_verified_deadline'

export interface EligibilityInput {
  /** Securities firewall flag from the DB policy row (§4.1) — never a caller literal downstream. */
  isSecurity: boolean
  /** Open + terminal term_conversion opportunities for this policy/household. */
  openOpportunities: { stage: string }[]
  /** Whether an active (non-terminal) enrollment already exists for this member+campaign. */
  priorEnrollmentActive: boolean
  /** Marketing opt-out / DNC on record (§11). */
  optedOut: boolean
  /** ISO date the most recent opportunity reached a terminal-lost state, or null. */
  lastTerminalAt: string | null
  /** Configurable re-enrollment cooldown after a terminal-lost opportunity (is_assumption). */
  cooldownDays: number
  /** Evaluation date (ISO). */
  now: string
  /** The policy's verified conversion deadline (ISO) from v_conversions_due, or null. */
  conversionDeadline: string | null
}

export interface EligibilityResult {
  eligible: boolean
  reasons: EligibilityReason[]
}

const DAY_MS = 86400000
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO.slice(0, 10))
  const b = Date.parse(bISO.slice(0, 10))
  return Math.round((a - b) / DAY_MS)
}

function isClosedWon(stage: string): boolean {
  return (CLOSED_WON_STAGES as readonly string[]).includes(stage)
}
function isTerminalLost(stage: string): boolean {
  return (TERMINAL_LOST_STAGES as readonly string[]).includes(stage)
}
/** Open = present but not in any terminal set. */
function isOpen(stage: string): boolean {
  return !isClosedWon(stage) && !isTerminalLost(stage)
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = []

  // Firewall first — a securities policy is never touched by automation, whatever else is true.
  if (input.isSecurity) reasons.push('securities_excluded')
  if (input.optedOut) reasons.push('opted_out')

  // Active Opportunity Ownership.
  if (input.openOpportunities.some((o) => isClosedWon(o.stage))) {
    reasons.push('closed_won') // permanent
  } else if (input.openOpportunities.some((o) => isOpen(o.stage))) {
    reasons.push('active_opportunity')
  } else if (
    input.openOpportunities.some((o) => isTerminalLost(o.stage)) &&
    input.lastTerminalAt != null &&
    daysBetween(input.now, input.lastTerminalAt) < input.cooldownDays
  ) {
    reasons.push('cooldown')
  }

  if (input.priorEnrollmentActive) reasons.push('duplicate_active')

  // Never manufacture urgency: no verified deadline → out (§4.3/§12).
  if (!input.conversionDeadline) reasons.push('no_verified_deadline')

  return { eligible: reasons.length === 0, reasons }
}
