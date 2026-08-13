// src/lib/district-nurture/conversation.ts
// PURE intent taxonomy for agent replies in the District Agent FS Nurture Campaign (ADR-038).
// Pause/resume/owner decisions live in engine.ts (shared). SELF-CONTAINED (no imports).
//
// The audience is a licensed Farmers agent, so the intents are about the PARTNERSHIP —
// making an introduction, asking to meet, asking a question, pausing, or opting out —
// not about a client buying a product. Anything that would require a licensed FS answer
// (a specific product/suitability/securities question the agent forwards on a client's
// behalf) escalates to the licensed FSA rather than being answered by automation.

export const NURTURE_INTENTS = [
  'referral', // the agent is handing off a client
  'meeting', // wants a call / live touchpoint
  'question', // a general partnership question
  'client_specific', // a specific client product/suitability/securities question → FSA
  'material_request', // wants a script / one-pager / resource
  'not_now', // pause / bad timing
  'unsubscribe', // opt out of the nurture
  'stop',
  'help',
  'unknown',
] as const
export type NurtureIntent = (typeof NURTURE_INTENTS)[number]

/** Intents that must be handled by the licensed FSA, never auto-answered. */
export const NURTURE_ESCALATION_INTENTS = ['referral', 'meeting', 'client_specific', 'question', 'unknown'] as const
export type NurtureEscalationIntent = (typeof NURTURE_ESCALATION_INTENTS)[number]

export function requiresAdvisorEscalation(intent: string): boolean {
  return (NURTURE_ESCALATION_INTENTS as readonly string[]).includes(intent)
}

export type NurtureExitOutcome = 'unsubscribe' | 'stop' | 'not_now'

/** Intents that end the proactive timeline (opt-out) vs merely pause it (not_now). */
export function exitOutcomeForIntent(intent: string): NurtureExitOutcome | null {
  if (intent === 'unsubscribe') return 'unsubscribe'
  if (intent === 'stop') return 'stop'
  if (intent === 'not_now') return 'not_now'
  return null
}
