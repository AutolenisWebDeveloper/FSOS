// src/lib/comms/evaluations.ts
// Slice 5 — Communication evaluations (PURE). Master build instruction §12.
//
// Every outbound AI message is automatically evaluated and BLOCKED on failure. This is
// the pure combiner: it takes the already-resolved signals (ownership from Slice 1,
// identity disclosure from Slice 2, purpose + consent from Slice 3, template approval,
// content) plus the AI message CLASS (§11 authority), and returns pass/fail + the
// authority. The send path records the result on agent_actions and only auto-sends when
// the message passes AND its class is auto-send; a draft-only class or any failure is
// held for the licensed FSA. Pure → unit-testable offline (tests/comms-ai-authority.test.mjs).

import { containsRecommendationLanguage } from '../compliance/guardrail'
import { evaluateAiAuthority, type AiAuthority, type AiMessageClass } from './ai-authority'

export interface EvalSignals {
  draft: string
  /** The AI message class (§11) — drives the authority level. */
  messageClass?: AiMessageClass | string | null
  /** A purpose (§9) is classified for this message. */
  purposeClassified: boolean
  /** Ownership resolved: correct actual sender / agency owner / agency / book (§7, Slice 1). */
  ownershipResolved: boolean
  /** Required first-touch identity disclosure is satisfied, or not required (§8, Slice 2). */
  identityDisclosureSatisfied: boolean
  /** Consent for this purpose/channel is on file (§9, Slice 3). */
  consentCompatible: boolean
  /** Approved template/version, an approved AI policy, or a licensed human authored it (§11). */
  templateApproved: boolean
  /** Prohibited sensitive information detected in the draft (§12). */
  containsSensitiveData?: boolean
  /** The draft asserts an unverified date/fact (§13 data confidence). */
  statesUnverifiedFact?: boolean
}

export interface EvalResult {
  /** No §12 evaluation failed. */
  pass: boolean
  /** The §11 authority for this message class. */
  authority: AiAuthority
  /** True only when pass AND the class may auto-send. Otherwise held for the FSA. */
  mayAutoSend: boolean
  /** Every failed §12 check (each independently blocks an auto-send). */
  failures: string[]
}

/**
 * Evaluate an outbound (AI) message (§12). First collects every failed check (so the
 * record shows all issues, not just the first), then combines with the §11 authority.
 * A blocked class (securities) is always a failure; a draft-only class passes content
 * evaluation but still may not auto-send.
 */
export function evaluateOutboundMessage(s: EvalSignals): EvalResult {
  const { authority } = evaluateAiAuthority(s.messageClass)
  const failures: string[] = []

  if (authority === 'blocked') failures.push('securities_blocked')
  if (containsRecommendationLanguage(s.draft)) failures.push('unsupported_recommendation')
  if (!s.purposeClassified) failures.push('missing_purpose_classification')
  if (!s.ownershipResolved) failures.push('ownership_unresolved')
  if (!s.identityDisclosureSatisfied) failures.push('identity_disclosure_missing')
  if (!s.consentCompatible) failures.push('consent_incompatible')
  if (!s.templateApproved) failures.push('template_or_policy_not_approved')
  if (s.containsSensitiveData === true) failures.push('prohibited_sensitive_info')
  if (s.statesUnverifiedFact === true) failures.push('unverified_fact_or_date')

  const pass = failures.length === 0
  return { pass, authority, mayAutoSend: pass && authority === 'auto_send', failures }
}
