// src/lib/comms/gate.ts
// GUARDRAIL 3 (decision core) — the 7-step communications gate, PURE.
// Every automated SMS/email passes these checks IN ORDER, blocking on the first
// failure (CLAUDE.md §7, data-guardrails §5). A blocked send is ALWAYS escalated,
// never silently dropped. The dispatcher (dispatcher.ts) wires this pure decision
// to consent/DNC lookups, audit, escalation, and the actual senders.
//
// Pure + relative imports → unit-testable offline (tests/guardrail.test.mjs).
import { containsRecommendationLanguage, withinQuietHours } from '../compliance/guardrail'

export type GateStep =
  | 'consent' // 1
  | 'quiet_hours' // 2 — legal TCPA floor (9–20 recipient-local), non-negotiable
  | 'business_hours' // 2b — operator's hours of operation (can only tighten the floor)
  | 'dnc' // 3
  | 'approved_template' // 4
  | 'recommendation' // 5
  | 'is_security' // 6
  | 'other_rule' // 7

export interface GateInput {
  draft: string
  channel: 'sms' | 'email'
  /** 1 — valid channel consent on file. */
  hasConsent: boolean
  /** 2 — recipient-local hour (0–23). */
  recipientLocalHour: number
  /**
   * 2b — inside the operator's configured hours of operation (business-local).
   * Defaults to true (no extra restriction) when omitted, so existing callers are
   * unaffected. A false here is a soft DEFERRAL (escalate=false), not a compliance
   * violation — the message is held for the next in-hours cycle, not escalated.
   */
  withinBusinessHours?: boolean
  /** 3 — on internal/external DNC. */
  onDNC: boolean
  /** 4 — approved template or approved AI policy. */
  usesApprovedTemplateOrPolicy: boolean
  /** 6 — record/recipient securities-flagged. */
  isSecurity: boolean
  /** 7 — any FFS/Farmers/carrier/state/federal rule block. */
  otherRuleBlocked?: boolean
}

export interface GateResult {
  allowed: boolean
  blockedStep?: GateStep
  reason?: string
  /** Blocked sends are logged + escalated to the human FSA, never dropped. */
  escalate: boolean
}

const BLOCK: Record<GateStep, string> = {
  consent: 'No valid channel consent on file.',
  quiet_hours: 'Outside permitted quiet hours (9:00–20:00 recipient-local).',
  business_hours: 'Outside configured hours of operation — held for the next in-hours cycle.',
  dnc: 'Recipient is on the do-not-contact list.',
  approved_template: 'Message does not use an approved template or AI policy.',
  recommendation: 'Message contains individualized recommendation / call-to-action language.',
  is_security: 'Securities-flagged record — excluded from automation; route to FFS-supervised handling.',
  other_rule: 'Blocked by an FFS/Farmers/carrier/state/federal rule.',
}

// Blocks escalate to the human FSA by default. The one exception is business_hours:
// being outside operating hours is an OPERATIONAL deferral (retry next cycle), not a
// compliance failure, so it does not escalate or record a compliance event.
function blocked(step: GateStep, escalate = true): GateResult {
  return { allowed: false, blockedStep: step, reason: BLOCK[step], escalate }
}

/**
 * Run the gate. First failing step wins. Order matters: the legal quiet-hours floor
 * (2) is checked BEFORE the operator's hours of operation (2b), so a send outside the
 * TCPA floor is always a compliance block, while a send inside the floor but outside
 * business hours is a soft deferral. Every block escalates EXCEPT business_hours.
 */
export function evaluateGate(input: GateInput): GateResult {
  if (!input.hasConsent) return blocked('consent')
  if (!withinQuietHours(input.recipientLocalHour)) return blocked('quiet_hours')
  if (input.withinBusinessHours === false) return blocked('business_hours', false)
  if (input.onDNC) return blocked('dnc')
  if (!input.usesApprovedTemplateOrPolicy) return blocked('approved_template')
  if (containsRecommendationLanguage(input.draft)) return blocked('recommendation')
  if (input.isSecurity) return blocked('is_security')
  if (input.otherRuleBlocked) return blocked('other_rule')
  return { allowed: true, escalate: false }
}
