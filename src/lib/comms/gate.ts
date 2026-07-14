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
  | 'quiet_hours' // 2
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
  dnc: 'Recipient is on the do-not-contact list.',
  approved_template: 'Message does not use an approved template or AI policy.',
  recommendation: 'Message contains individualized recommendation / call-to-action language.',
  is_security: 'Securities-flagged record — excluded from automation; route to FFS-supervised handling.',
  other_rule: 'Blocked by an FFS/Farmers/carrier/state/federal rule.',
}

function blocked(step: GateStep): GateResult {
  return { allowed: false, blockedStep: step, reason: BLOCK[step], escalate: true }
}

/** Run the 7-step gate. First failing step wins; every block escalates. */
export function evaluateGate(input: GateInput): GateResult {
  if (!input.hasConsent) return blocked('consent')
  if (!withinQuietHours(input.recipientLocalHour)) return blocked('quiet_hours')
  if (input.onDNC) return blocked('dnc')
  if (!input.usesApprovedTemplateOrPolicy) return blocked('approved_template')
  if (containsRecommendationLanguage(input.draft)) return blocked('recommendation')
  if (input.isSecurity) return blocked('is_security')
  if (input.otherRuleBlocked) return blocked('other_rule')
  return { allowed: true, escalate: false }
}
