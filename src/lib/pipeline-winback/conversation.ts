// src/lib/pipeline-winback/conversation.ts
// Win-Back conversation intent taxonomy (spec §9), PURE. The pause/resume timeout + advisor-
// ownership DECISIONS are the module-agnostic shared primitives, reused verbatim from the
// campaign engine (ADR-031 §3) — see engine.ts. This file only carries the §9 intent library
// and which intents force advisor escalation rather than an AI-generated substantive answer
// (§4.2 red-line: no individualized product/premium/suitability answer from automation).

// The §9 intent library, classified from a customer reply.
export const WINBACK_INTENTS = [
  'interested',
  'appointment',
  'quote',
  'application',
  'coverage_question',
  'budget',
  'existing_coverage',
  'need_more_time',
  'purchased_elsewhere',
  'not_interested',
  'stop',
  'help',
  'unknown',
] as const
export type WinbackIntent = (typeof WINBACK_INTENTS)[number]

// Intents that MUST route to advisor escalation instead of an AI substantive answer (§9/§4.2):
// anything that would require a coverage recommendation, premium estimate, medical/underwriting,
// carrier comparison, suitability, replacement, or tax/legal/financial/investment advice — plus
// any unknown/low-confidence classification (never guess). 'quote' and 'application' escalate
// because a real quote/underwriting answer is licensed advisor territory.
export const WINBACK_ESCALATION_INTENTS = [
  'quote',
  'application',
  'coverage_question',
  'budget',
  'existing_coverage',
  'unknown',
] as const
export type WinbackEscalationIntent = (typeof WINBACK_ESCALATION_INTENTS)[number]

/** Whether a classified intent forces advisor escalation (no AI substantive answer). */
export function requiresAdvisorEscalation(intent: string): boolean {
  return (WINBACK_ESCALATION_INTENTS as readonly string[]).includes(intent)
}

// The intents that constitute a campaign EXIT (spec §10 state machine). Each maps to a downstream
// workflow; 'need_more_time' is the Future Follow-Up lifecycle (spec §0.12), not a dead end.
export type WinbackExitOutcome =
  | 'appointment'
  | 'quote'
  | 'application'
  | 'purchased_elsewhere'
  | 'not_interested'
  | 'stop'
  | 'future_follow_up'

/** Map a terminal intent to its §10 exit outcome, or null when the conversation is non-terminal. */
export function exitOutcomeForIntent(intent: string): WinbackExitOutcome | null {
  switch (intent) {
    case 'appointment':
      return 'appointment'
    case 'quote':
      return 'quote'
    case 'application':
      return 'application'
    case 'purchased_elsewhere':
      return 'purchased_elsewhere'
    case 'not_interested':
      return 'not_interested'
    case 'stop':
      return 'stop'
    case 'need_more_time':
      return 'future_follow_up'
    default:
      return null
  }
}
