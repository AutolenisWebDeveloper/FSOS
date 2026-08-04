// src/lib/pipeline-winback/eligibility.ts
// The Pipeline Win-Back eligibility gate, PURE (no DB/clock). Both the enrollment service and
// the per-touch tick call this, because eligibility must be recomputed before enrollment AND
// before every scheduled touch — a newly opened/reopened opportunity, a booked appointment, a
// reply, or an opt-out between the daily sweep and a touch must immediately pause/exit the
// enrollment (owner-confirmed precedence, ADR-031).
//
// Population (ADR-031, spec §0.1): this targets STALLED INTERNAL pipeline opportunities —
// NOT the imported-list win_back origination flow (src/lib/opportunities/winback.ts). The
// candidate is an opportunity, not a contact.
//
// Precedence (owner-confirmed 2026-07-31): (1) an active advisor-owned opportunity outranks
// automation; (2) Pipeline Win-Back; (3) Imported Win-Back. Shared suppression (opt-out/DNC,
// active appointment, active conversation) applies across both win-back modules and is enforced
// here plus again at the send gate. Kept SELF-CONTAINED for the isolated-compile unit test.

// The opportunity stages a stalled internal opportunity can occupy to be win-back-eligible.
// 'quoted_proposed' covers "quote completed/requested/expired" (staleness, no expiry field —
// ADR-031); 'application' covers "started/abandoned application"; 'lost' is a lost opportunity;
// 'prospect'/'fact_find' cover "no activity for a configurable period". 'underwriting_suitability'
// and 'placed_issued' are excluded (active advisor work / already-won → not win-back targets).
export const WINBACK_CANDIDATE_STAGES = [
  'prospect',
  'fact_find',
  'quoted_proposed',
  'application',
  'lost',
] as const

export type WinbackCategory = 'lost' | 'stalled_quote' | 'abandoned_application' | 'inactive'

/** Human/analytics label for the win-back reason, derived from the candidate stage. */
export function winbackCategory(stage: string): WinbackCategory | null {
  switch (stage) {
    case 'lost':
      return 'lost'
    case 'quoted_proposed':
      return 'stalled_quote'
    case 'application':
      return 'abandoned_application'
    case 'prospect':
    case 'fact_find':
      return 'inactive'
    default:
      return null
  }
}

export type WinbackEligibilityReason =
  | 'securities_excluded'
  | 'opted_out'
  | 'not_candidate'
  | 'not_stalled'
  | 'active_advisor_opportunity'
  | 'active_appointment'
  | 'in_conversation'
  | 'duplicate_active'

export interface WinbackEligibilityInput {
  /** Securities firewall flag from the candidate opportunity (§4.1) — never a caller literal downstream. */
  isSecurity: boolean
  /** Marketing opt-out / DNC on record for the household (§12). Shared suppression. */
  optedOut: boolean
  /** The candidate opportunity's current stage. */
  stage: string
  /** Days since the opportunity's last touch (max of updated_at and last activity). */
  staleDays: number
  /** Configurable minimum staleness before a candidate is re-engaged (is_assumption). */
  staleMinDays: number
  /** Precedence #1: the household has a fresh/active advisor-owned opportunity (see data.ts). */
  hasActiveAdvisorOpportunity: boolean
  /** Shared suppression: an upcoming (scheduled, future) appointment for the household. */
  hasUpcomingAppointment: boolean
  /** Shared suppression: an active/paused-for-conversation enrollment or open comms conversation. */
  inActiveConversation: boolean
  /** Idempotency: a live enrollment already exists for this opportunity+campaign. */
  priorEnrollmentActive: boolean
}

export interface WinbackEligibilityResult {
  eligible: boolean
  reasons: WinbackEligibilityReason[]
}

export function evaluateWinbackEligibility(input: WinbackEligibilityInput): WinbackEligibilityResult {
  const reasons: WinbackEligibilityReason[] = []

  // Firewall first — a securities opportunity is never touched by automation (§4.1).
  if (input.isSecurity) reasons.push('securities_excluded')
  // Shared suppression (§12) — opt-out/DNC applies across both win-back modules.
  if (input.optedOut) reasons.push('opted_out')

  // Must be a stalled-opportunity candidate stage, and actually stale.
  if (!(WINBACK_CANDIDATE_STAGES as readonly string[]).includes(input.stage)) reasons.push('not_candidate')
  else if (input.staleDays < input.staleMinDays) reasons.push('not_stalled')

  // Precedence #1: an active advisor-owned opportunity outranks win-back automation.
  if (input.hasActiveAdvisorOpportunity) reasons.push('active_advisor_opportunity')

  // Shared suppression: an existing appointment or an active conversation pauses outreach.
  if (input.hasUpcomingAppointment) reasons.push('active_appointment')
  if (input.inActiveConversation) reasons.push('in_conversation')

  // Duplicate-enrollment guard (§4a) — one live enrollment per opportunity.
  if (input.priorEnrollmentActive) reasons.push('duplicate_active')

  return { eligible: reasons.length === 0, reasons }
}

/** Outcome for an ALREADY-ENROLLED opportunity that fails the pre-touch recheck. */
export type RecheckOutcome = 'suppressed' | 'paused_for_conversation' | 'exited'

// Reasons that mean the campaign genuinely yields for good (advisor now owns it, or it was never a
// real candidate) — terminal even when a conversation is also open.
const TERMINAL_YIELD_REASONS = new Set<string>([
  'securities_excluded', 'opted_out', 'active_advisor_opportunity', 'active_appointment',
  'no_longer_eligible', 'not_candidate', 'not_stalled', 'duplicate_active',
])

/**
 * Map a failed pre-touch recheck's reasons to the enrollment's next state (pure; ADR-018):
 *  • securities/opt-out                                   → SUPPRESS (terminal compliance stop);
 *  • a newly-open customer conversation, nothing terminal → PAUSE_FOR_CONVERSATION (resumable —
 *    the resume-paused sweep returns it to 'active' once the conversation closes / goes quiet, so
 *    a single reply never terminally strands the enrollment);
 *  • anything else                                        → EXIT (yield to advisor / no-longer-eligible).
 */
export function classifyRecheckOutcome(reasons: readonly string[]): RecheckOutcome {
  if (reasons.includes('securities_excluded') || reasons.includes('opted_out')) return 'suppressed'
  if (reasons.includes('in_conversation') && !reasons.some((r) => TERMINAL_YIELD_REASONS.has(r))) {
    return 'paused_for_conversation'
  }
  return 'exited'
}
