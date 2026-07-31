// src/lib/life-campaign/conversation.ts
// Conversation timeout + ownership-handoff decisions, PURE (no DB/clock). Composes with the
// existing evaluateResume (comms/conversation-mode.ts) — resume is still decided there; this
// module adds the two decisions §13b/§13c introduce that conversation-mode does not cover:
//   • when a client replies once then goes silent (timeout → abandoned close), and
//   • who owns outbound to the client (AI vs a specific advisor) once escalation fires.
// Only one owner may send at a time — the tick service enforces that with these decisions.

export interface ConversationTimeoutInput {
  /** Minutes since the client's last inbound reply, or null if none yet. */
  minutesSinceLastReply: number | null
  /** Configurable timeout window (defaults align with comm_conversation_policy quiet period). */
  timeoutHours: number
  /** If the conversation has been escalated to an advisor, the AI does not own the clock. */
  escalatedToAdvisor: boolean
}

export interface ConversationTimeoutDecision {
  close: boolean
  outcome: 'abandoned' | null
}

/**
 * Decide whether an AI-owned conversation has timed out. An escalated conversation is never
 * auto-closed here — the advisor's workflow owns it (§13c), so the campaign can't resume out
 * from under an advisor still working the lead.
 */
export function evaluateConversationTimeout(input: ConversationTimeoutInput): ConversationTimeoutDecision {
  if (input.escalatedToAdvisor) return { close: false, outcome: null }
  if (input.minutesSinceLastReply == null) return { close: false, outcome: null }
  const timedOut = input.minutesSinceLastReply >= input.timeoutHours * 60
  return timedOut ? { close: true, outcome: 'abandoned' } : { close: false, outcome: null }
}

export interface OwnerInput {
  /** An escalation trigger (§10) has fired for this conversation. */
  escalated: boolean
  /** The assigned advisor has accepted the handoff. */
  advisorAccepted: boolean
}

/**
 * Who may send outbound to the client. Once escalated, ownership belongs to the advisor even
 * before acceptance — the AI must NOT answer a compliance-sensitive question while awaiting
 * advisor pickup (§13c). Only after de-escalation/closure does ownership return to automation.
 */
export function resolveOwner(input: OwnerInput): 'ai' | 'advisor' {
  return input.escalated ? 'advisor' : 'ai'
}

// The §6a intents that must route to advisor escalation rather than an AI-generated
// substantive answer (§10) — existing coverage, cost, eligibility, medical, timing/deadline,
// an explicit advisor request, and any unknown/low-confidence classification (never guess).
export const COMPLIANCE_SENSITIVE_INTENTS = [
  'existing_coverage',
  'cost_concern',
  'eligibility_question',
  'medical_question',
  'timing_deadline',
  'advisor_request',
  'unknown',
] as const
export type ComplianceSensitiveIntent = (typeof COMPLIANCE_SENSITIVE_INTENTS)[number]
