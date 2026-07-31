// src/lib/cross-sell-life/conversation.ts
// Conversation timeout + ownership-handoff + intent decisions, PURE (no DB/clock). Composes with
// the existing evaluateResume (comms/conversation-mode.ts) — resume is still decided there; this
// module adds the decisions §13/§14 introduce that conversation-mode does not cover:
//   • when a client replies once then goes silent (timeout → respectful close),
//   • who owns outbound to the client (AI vs advisor) once escalation fires, and
//   • whether a classified intent must escalate or may be handled by the AI (green zone).
// Only one owner may send at a time — the tick/inbound services enforce that with these decisions.

export interface ConversationTimeoutInput {
  minutesSinceLastReply: number | null
  timeoutHours: number
  escalatedToAdvisor: boolean
}
export interface ConversationTimeoutDecision {
  close: boolean
  outcome: 'abandoned' | null
}

/** An escalated conversation is never auto-closed here — the advisor's workflow owns it (§14). */
export function evaluateConversationTimeout(input: ConversationTimeoutInput): ConversationTimeoutDecision {
  if (input.escalatedToAdvisor) return { close: false, outcome: null }
  if (input.minutesSinceLastReply == null) return { close: false, outcome: null }
  const timedOut = input.minutesSinceLastReply >= input.timeoutHours * 60
  return timedOut ? { close: true, outcome: 'abandoned' } : { close: false, outcome: null }
}

export interface OwnerInput {
  escalated: boolean
  advisorAccepted: boolean
}
/** Once escalated, ownership belongs to the advisor even before acceptance — the AI must NOT answer
 *  a compliance-sensitive question while awaiting pickup (§14). */
export function resolveOwner(input: OwnerInput): 'ai' | 'advisor' {
  return input.escalated ? 'advisor' : 'ai'
}

// The full §13 inbound intent library. Stored on the conversation session for classification.
export const INTENT_LIBRARY = [
  'interested', 'appointment', 'reschedule', 'cancel_appointment', 'quote', 'application',
  'general_coverage_question', 'budget', 'employer_coverage', 'existing_individual_coverage',
  'existing_policy', 'life_change', 'need_more_time', 'follow_up_later', 'purchased_elsewhere',
  'not_interested', 'complaint', 'stop', 'help', 'wrong_number', 'deceased', 'advisor_requested',
  'unknown',
] as const
export type Intent = (typeof INTENT_LIBRARY)[number]

// Intents that MUST route to advisor escalation rather than an AI-generated substantive answer
// (§14): any recommendation/coverage/premium/quote/carrier request, medical/health/underwriting,
// replacement, suitability, tax/legal/investment/securities, complaint/threat, vulnerable-client
// concern, advisor-identity confusion, and any unknown/low-confidence high-impact intent.
export const ESCALATION_INTENTS = new Set<Intent>([
  'quote', 'application', 'budget', 'general_coverage_question', 'existing_individual_coverage',
  'existing_policy', 'complaint', 'advisor_requested', 'unknown',
])

// Intents the STOP/HELP keyword layer owns (never treated as consent; HELP returns the approved
// response). Handled by lib/comms/keywords.ts, surfaced here for classification completeness.
export const KEYWORD_INTENTS = new Set<Intent>(['stop', 'help'])

// Intents that terminate the enrollment with a specific §15 exit reason (mapped by the inbound
// handler). Kept as data so the mapping is auditable in one place.
export const INTENT_EXIT_REASON: Partial<Record<Intent, string>> = {
  not_interested: 'not_interested',
  purchased_elsewhere: 'purchased_elsewhere',
  wrong_number: 'wrong_number',
  deceased: 'deceased',
  stop: 'sms_stop',
}

export interface IntentDecision {
  escalate: boolean
  /** True when confidence is below the campaign threshold — routes to advisor review, never a
   *  high-impact automated action (§13). */
  lowConfidence: boolean
}

/** Decide handling for a classified intent. Low-confidence OR an escalation intent → advisor. */
export function decideIntent(intent: Intent, confidence: number, threshold: number): IntentDecision {
  const lowConfidence = confidence < threshold
  const escalate = lowConfidence || ESCALATION_INTENTS.has(intent)
  return { escalate, lowConfidence }
}
