// src/lib/compliance/guardrail.ts
// GUARDRAIL 2 — AI green-zone / red-line validator (CLAUDE.md §2.2, data-guardrails §4).
// Every AI-generated client-facing message passes through here BEFORE dispatch.
// A failure is a HARD BLOCK routed to the human FSA — never sent. Pure (no I/O)
// so it gates any layer and is unit-tested offline (tests/guardrail.test.mjs).
//
// Extends the existing lib/compliance.ts constants (green/red action lists,
// FINRA disclaimer) rather than recreating them (relative import keeps the pure
// core compilable by the standalone test harness).
import { AI_PERMITTED_ACTIONS, AI_PROHIBITED_ACTIONS } from '../compliance'

// Re-export the canonical action lists so UI/agent tool definitions read the same
// source of truth for what is allowed (green zone) vs forbidden (red line).
export const GREEN_ZONE_ACTIONS = AI_PERMITTED_ACTIONS
export const RED_LINE_ACTIONS = AI_PROHIBITED_ACTIONS

export type BlockReason =
  | 'recommendation'
  | 'securities'
  | 'no_consent'
  | 'quiet_hours'
  | 'dnc'
  | 'unapproved_template'

export interface GuardrailContext {
  /** The record/recipient is securities-flagged (firewall). */
  isSecurity: boolean
  /** Valid channel consent on file for this recipient. */
  hasConsent: boolean
  /** Recipient-LOCAL hour of day (0–23) at send time. */
  recipientLocalHour: number
  /** Recipient is on internal or applicable external DNC. */
  onDNC: boolean
  /** Draft uses an approved template or an approved AI policy. */
  usesApprovedTemplateOrPolicy: boolean
}

export interface GuardrailResult {
  allow: boolean
  reasons: BlockReason[]
}

// Individualized product/policy/investment/replacement/allocation/transaction
// "call to action" language. Conservative: err toward blocking (a slip past this
// in eval is a build-blocking defect per acceptance-checklist §1).
const RECOMMENDATION_PATTERNS: RegExp[] = [
  /\bi\s+recommend\b/i,
  /\bwe\s+recommend\b/i,
  /\b(you|we)\s+should\s+(buy|purchase|invest|convert|replace|roll\s*over|allocate|sell)\b/i,
  /\byou\s+should\s+(get|choose|pick)\s+(this|that|the)\b/i,
  /\bbest\s+(product|policy|plan|investment|option)\s+for\s+you\b/i,
  /\bright\s+(product|policy|plan|fit)\s+for\s+you\b/i,
  /\b(buy|purchase|invest\s+in|allocate\s+to)\s+(this|that|these)\b/i,
  /\breplace\s+your\s+(policy|coverage|plan)\s+with\b/i,
  /\bi\s+suggest\s+(you|that\s+you)\s+(buy|purchase|invest|convert|replace)\b/i,
  /\bput\s+your\s+money\s+(in|into)\b/i,
  /\bconvert\s+to\s+the\s+\w+\s+(policy|product|plan)\b/i,
]

/** True if the draft contains individualized recommendation / call-to-action language. */
export function containsRecommendationLanguage(draft: string): boolean {
  return RECOMMENDATION_PATTERNS.some((re) => re.test(draft))
}

/** Conservative quiet-hours floor: 9:00–20:00 recipient-local (data-guardrails §5.2). */
export function withinQuietHours(recipientLocalHour: number): boolean {
  return recipientLocalHour >= 9 && recipientLocalHour < 20
}

/**
 * Operator-configured HOURS OF OPERATION for automated outreach — the FSA's control
 * over when the AI may work. Evaluated in the BUSINESS timezone. This can only ever
 * make sending MORE restrictive than the legal quiet-hours floor: the gate always
 * applies withinQuietHours() (recipient-local 9–20) AND this window, so a wider
 * business window can never push a send past the TCPA floor. When disabled/unset,
 * only the legal floor applies (no behavior change).
 */
export interface BusinessHoursPolicy {
  enabled: boolean
  /** Inclusive start hour (0–23), business-local. */
  startHour: number
  /** Exclusive end hour (1–24), business-local. */
  endHour: number
  /** Allowed days of week: 0=Sun … 6=Sat. Empty ⇒ no day allowed. */
  days: number[]
}

/**
 * True if a send is inside the operator's hours of operation. Pure + deterministic.
 * A null/undefined or disabled policy imposes NO extra restriction (returns true) —
 * the legal quiet-hours floor still applies separately in the gate.
 */
export function withinBusinessHours(
  businessLocalHour: number,
  businessLocalDay: number,
  policy?: BusinessHoursPolicy | null,
): boolean {
  if (!policy || !policy.enabled) return true
  if (!policy.days.includes(businessLocalDay)) return false
  return businessLocalHour >= policy.startHour && businessLocalHour < policy.endHour
}

/**
 * Validate an AI-drafted client-facing message. Collects EVERY failing reason
 * (not just the first) so the escalation carries full context. allow === true
 * only when there are zero reasons.
 */
export function validateAIClientMessage(draft: string, ctx: GuardrailContext): GuardrailResult {
  const reasons: BlockReason[] = []
  if (containsRecommendationLanguage(draft)) reasons.push('recommendation')
  if (ctx.isSecurity) reasons.push('securities')
  if (!ctx.hasConsent) reasons.push('no_consent')
  if (!withinQuietHours(ctx.recipientLocalHour)) reasons.push('quiet_hours')
  if (ctx.onDNC) reasons.push('dnc')
  if (!ctx.usesApprovedTemplateOrPolicy) reasons.push('unapproved_template')
  return { allow: reasons.length === 0, reasons }
}
