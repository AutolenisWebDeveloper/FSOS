// src/lib/comms/conversation-mode.ts
// Slice 4 — Campaign mode vs conversation mode (PURE decision). Master build §10.
//
// A customer reply flips the enrollment into PAUSED_FOR_CONVERSATION; the drip runner
// (which only advances status='enrolled') then skips it, so FSOS never sends a
// "we haven't heard back" follow-up after the customer has already replied. This module
// is the pure resume decision — no DB, no clock — so it is unit-testable offline
// (tests/comms-conversation.test.mjs). Automation resumes ONLY when §10 allows:
// the conversation is resolved, the customer has gone quiet for the configured period,
// or an authorized user resumes it.

export type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'resolved' | 'pending' | string

export interface ResumeInput {
  /** The thread's current status. resolved/closed → the conversation is done. */
  conversationStatus: ConversationStatus
  /** Minutes since the customer's most recent INBOUND message (null = none since pause). */
  minutesSinceLastInbound: number | null
  /** Configured quiet period (days) after which a quiet contact's automation resumes. */
  resumeQuietDays: number
  /** An authorized user explicitly resumed this enrollment. */
  manualResume?: boolean
}

export interface ResumeDecision {
  resume: boolean
  reason: string
}

/**
 * Decide whether a PAUSED_FOR_CONVERSATION enrollment may resume (§10). Order: authorized
 * manual resume → conversation resolved/closed → customer quiet for the configured period.
 * Otherwise it stays paused (the conversation is still live — never resume into an active
 * back-and-forth, and never send a "haven't heard back" message after a reply).
 */
export function evaluateResume(input: ResumeInput): ResumeDecision {
  if (input.manualResume === true) {
    return { resume: true, reason: 'Authorized user resumed the enrollment.' }
  }
  if (input.conversationStatus === 'resolved' || input.conversationStatus === 'closed') {
    return { resume: true, reason: 'Conversation resolved/closed — automation may resume.' }
  }
  if (
    input.minutesSinceLastInbound != null &&
    input.minutesSinceLastInbound >= input.resumeQuietDays * 24 * 60
  ) {
    return { resume: true, reason: `Customer quiet ≥ ${input.resumeQuietDays} day(s) — automation may resume.` }
  }
  return { resume: false, reason: 'Conversation is still active — automation remains paused.' }
}

/**
 * Whether an inbound message should pause promotional automation for the contact (§10).
 * Every genuine customer reply pauses — the only inbound we do NOT treat as a
 * conversation is a bare keyword already handled as consent (STOP/HELP/START), which is
 * processed on its own path (STOP additionally opts the contact out entirely).
 */
export function shouldPauseOnReply(isKeywordOnly: boolean): boolean {
  return !isKeywordOnly
}
