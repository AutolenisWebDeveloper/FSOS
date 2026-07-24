// src/lib/comms/ai-authority.ts
// Slice 5 — AI authority matrix (PURE). Master build instruction §11.
//
// Which AI-generated message CLASSES the autonomous AI may auto-send, which it may only
// DRAFT for human review, and which are BLOCKED. Enforced "through code and message
// classification — not prompts" (§11): the send path classifies the AI message and this
// matrix decides. A draft_only/blocked class is never auto-sent — it is held for the
// human FSA. This is a pure decision (no DB) so it is unit-testable offline
// (tests/comms-ai-authority.test.mjs) and is the authoritative source for the wiring.

export type AiAuthority = 'auto_send' | 'draft_only' | 'blocked'

// The message classes the autonomous AI can produce (§11). Green-zone, low-risk classes
// may auto-send; anything advisory, policy-specific, pricing, securities, sensitive, or
// case-affecting may only be drafted for the licensed FSA; securities is hard-blocked.
export type AiMessageClass =
  // ── auto-send (approved, low-risk) ──
  | 'approved_first_touch'
  | 'scheduled_campaign'
  | 'birthday'
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'scheduling_link'
  | 'receipt_acknowledgment'
  | 'stop_help_unsubscribe_confirmation'
  | 'availability_question'
  | 'approved_thank_you'
  // ── draft-only (needs licensed human review) ──
  | 'policy_specific_explanation'
  | 'term_conversion_interpretation'
  | 'pricing_premium'
  | 'coverage_recommendation'
  | 'needs_analysis_conclusion'
  | 'product_comparison'
  | 'replacement_discussion'
  | 'underwriting_question'
  | 'complaint_or_dispute'
  | 'sensitive_data_request'
  | 'financial_recommendation'
  | 'case_or_application_affecting'
  // ── blocked (never from FSOS) ──
  | 'securities_related'

const AUTO_SEND: ReadonlySet<AiMessageClass> = new Set<AiMessageClass>([
  'approved_first_touch',
  'scheduled_campaign',
  'birthday',
  'appointment_confirmation',
  'appointment_reminder',
  'scheduling_link',
  'receipt_acknowledgment',
  'stop_help_unsubscribe_confirmation',
  'availability_question',
  'approved_thank_you',
])

const BLOCKED: ReadonlySet<AiMessageClass> = new Set<AiMessageClass>(['securities_related'])

export interface AuthorityDecision {
  authority: AiAuthority
  reason: string
}

/**
 * Decide the authority for an AI message class (§11). Securities is blocked (firewall,
 * §4.1); the approved low-risk classes auto-send; everything advisory / policy-specific /
 * pricing / sensitive / case-affecting is draft-only (held for the licensed FSA). An
 * UNKNOWN/unclassified message fails safe to draft_only — the AI never auto-sends
 * something the code could not positively classify as low-risk.
 */
export function evaluateAiAuthority(messageClass: AiMessageClass | string | null | undefined): AuthorityDecision {
  if (messageClass && BLOCKED.has(messageClass as AiMessageClass)) {
    return { authority: 'blocked', reason: 'Securities-related — never sent from FSOS; route to FFS-supervised handling.' }
  }
  if (messageClass && AUTO_SEND.has(messageClass as AiMessageClass)) {
    return { authority: 'auto_send', reason: `Approved low-risk class "${messageClass}" — may auto-send.` }
  }
  // Every other known class is advisory/sensitive → draft-only; unknown → fail-safe draft.
  return {
    authority: 'draft_only',
    reason: messageClass
      ? `Class "${messageClass}" requires licensed FSA review — drafted, not auto-sent.`
      : 'Unclassified AI message — fail-safe to human review (never auto-sent).',
  }
}

/** Convenience: may this AI message class be auto-sent? (false for draft_only + blocked). */
export function mayAutoSend(messageClass: AiMessageClass | string | null | undefined): boolean {
  return evaluateAiAuthority(messageClass).authority === 'auto_send'
}
