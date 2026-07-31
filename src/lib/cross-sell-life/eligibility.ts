// src/lib/cross-sell-life/eligibility.ts
// The Cross-Sell Life Campaign eligibility gate, PURE (no DB/clock). Both the enrollment service
// and the per-touch tick call this, because eligibility must be recomputed immediately BEFORE
// enrollment AND immediately BEFORE every scheduled touch (spec §3).
//
// Audience (§3): an EXISTING agency client who holds >=1 non-life product / agency relationship,
// has NO active life policy / application / opportunity with us, has the required consent, is in a
// licensed jurisdiction, and is not otherwise restricted. Population separation (ADR-029/031):
// clients owned by the Life Conversion or Win-Back campaigns are NOT enrolled here.
//
// The pure function returns the full reason set (never short-circuits) so a signal that appears
// AFTER enrollment produces an accurate exit reason at the per-touch recheck.

export type EligibilityReason =
  // Hard exclusions (never overridable)
  | 'securities_excluded'      // §4.1 firewall
  | 'opted_out'                // global marketing suppression / do-not-contact
  | 'has_active_life_policy'   // already owns life with us
  | 'has_active_life_application'
  | 'has_active_life_opportunity'
  | 'in_life_conversion'       // owned by Life Conversion Campaign
  | 'in_winback'               // owned by Win-Back Campaign (imported or pipeline)
  | 'no_qualifying_relationship' // not an existing non-life client
  | 'duplicate_active'         // already enrolled in THIS campaign
  | 'no_valid_contact'         // invalid email AND invalid phone
  | 'outside_jurisdiction'     // advisor not licensed in client's state
  | 'deceased'
  | 'compliance_hold'          // compliance or legal hold
  | 'existing_life_appointment'
  | 'active_advisor_conversation'
  // Soft exclusion (overridable by force-enroll)
  | 'cooldown'                 // §3 re-enroll cooldown after a terminal, non-converting run

export interface EligibilityInput {
  /** Securities firewall flag (§4.1) — never a caller literal downstream. */
  isSecurity: boolean
  /** Global marketing suppression / household do_not_contact. Per-channel consent is additionally
   *  enforced by the send gate; this is the campaign-level global opt-out. */
  optedOut: boolean
  /** Has an active life policy with the agency (v_cross_sell_gaps.has_life). */
  hasActiveLifePolicy: boolean
  /** Has an in-flight life application/case. */
  hasActiveLifeApplication: boolean
  /** Has an open (non-terminal) life opportunity being worked. */
  hasActiveLifeOpportunity: boolean
  /** Currently an active enrollment in the Life Conversion Campaign. */
  inLifeConversion: boolean
  /** Currently an eligible/active Win-Back subject (imported win_back or pipeline win-back). */
  inWinback: boolean
  /** Holds >=1 non-life product family OR came through an agency partnership (existing client). */
  hasQualifyingRelationship: boolean
  /** An active (non-terminal) enrollment already exists for this member in THIS campaign. */
  priorEnrollmentActive: boolean
  /** At least one deliverable channel: a valid email OR a valid phone. */
  hasValidContact: boolean
  /** The assigned advisor is licensed in the client's jurisdiction (state). */
  jurisdictionLicensed: boolean
  /** Client is recorded deceased. */
  deceased: boolean
  /** A compliance or legal hold is in effect. */
  onComplianceHold: boolean
  /** An existing life-insurance appointment is scheduled. */
  hasLifeAppointment: boolean
  /** An advisor currently owns an open life conversation with this client. */
  advisorConversationActive: boolean
  /** ISO date the most recent enrollment reached a terminal, non-converting state, or null. */
  lastTerminalAt: string | null
  /** Configurable re-enrollment cooldown days (§3 default 365, is_assumption). */
  cooldownDays: number
  /** Evaluation date (ISO). */
  now: string
}

export interface EligibilityResult {
  eligible: boolean
  reasons: EligibilityReason[]
}

// Reasons a force/manual override may waive (§5). Everything else — firewall, opt-out, an existing
// life relationship/opportunity, population separation, invalid contact, jurisdiction, deceased,
// holds, duplicate — is NEVER overridable.
export const OVERRIDABLE_REASONS = new Set<EligibilityReason>(['cooldown'])

const DAY_MS = 86400000
function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO.slice(0, 10))
  const b = Date.parse(bISO.slice(0, 10))
  return Math.round((a - b) / DAY_MS)
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = []

  // Firewall first — a securities relationship is never touched by automation (§4.1).
  if (input.isSecurity) reasons.push('securities_excluded')
  if (input.optedOut) reasons.push('opted_out')

  // Must be an existing non-life client (§3 audience).
  if (!input.hasQualifyingRelationship) reasons.push('no_qualifying_relationship')

  // Existing life relationship — belongs to a different workflow, not this cross-sell campaign.
  if (input.hasActiveLifePolicy) reasons.push('has_active_life_policy')
  if (input.hasActiveLifeApplication) reasons.push('has_active_life_application')
  if (input.hasActiveLifeOpportunity) reasons.push('has_active_life_opportunity')

  // Population separation (ADR-029 / ADR-031).
  if (input.inLifeConversion) reasons.push('in_life_conversion')
  if (input.inWinback) reasons.push('in_winback')

  // Engagement / restriction exclusions.
  if (input.hasLifeAppointment) reasons.push('existing_life_appointment')
  if (input.advisorConversationActive) reasons.push('active_advisor_conversation')
  if (input.deceased) reasons.push('deceased')
  if (input.onComplianceHold) reasons.push('compliance_hold')

  // Deliverability + licensing.
  if (!input.hasValidContact) reasons.push('no_valid_contact')
  if (!input.jurisdictionLicensed) reasons.push('outside_jurisdiction')

  // Duplicate + cooldown.
  if (input.priorEnrollmentActive) reasons.push('duplicate_active')
  if (
    input.lastTerminalAt != null &&
    daysBetween(input.now, input.lastTerminalAt) < input.cooldownDays
  ) {
    reasons.push('cooldown')
  }

  return { eligible: reasons.length === 0, reasons }
}

/** Apply a force/manual override: keep only the reasons an override cannot waive. */
export function blockingAfterOverride(reasons: EligibilityReason[], override: boolean): EligibilityReason[] {
  return override ? reasons.filter((r) => !OVERRIDABLE_REASONS.has(r)) : reasons
}
