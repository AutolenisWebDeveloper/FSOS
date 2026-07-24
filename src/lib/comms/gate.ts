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
  | 'ownership' // 0 — authoritative ownership must resolve; unresolved → assignment review
  | 'consent' // 1
  | 'quiet_hours' // 2 — legal TCPA floor (9–20 recipient-local), non-negotiable
  | 'business_hours' // 2b — operator's hours of operation (can only tighten the floor)
  | 'frequency' // 2d — per-recipient rate caps (operational deferral, §9)
  | 'collision' // 2e — higher-priority campaign / active conversation underway (§10)
  | 'delegation' // 2c — FSA↔agency-owner on-behalf-of authority must be ACTIVE + in-scope
  | 'dnc' // 3
  | 'approved_template' // 4
  | 'recommendation' // 5
  | 'is_security' // 6
  | 'other_rule' // 7

export interface GateInput {
  draft: string
  channel: 'sms' | 'email'
  /**
   * 0 — authoritative ownership resolved (agency / agency-owner / represented-agent /
   * actual sender). Defaults to TRUE so existing callers are unaffected. A false is a
   * HARD block that ESCALATES: the record is routed to the assignment-review queue and
   * is never sent on ambiguous ownership (master build instruction §6).
   */
  ownershipResolved?: boolean
  /** 0b — reason ownership could not be resolved (for the review queue + audit). */
  ownershipConflict?: string
  /**
   * 2c — the FSA↔agency-owner delegation authorizing this on-behalf-of send is ACTIVE
   * and in-scope. Defaults to TRUE (a send that is NOT on behalf of an agency owner —
   * direct FSA / human / transactional — is unconstrained here). A false HARD-blocks +
   * escalates (§7): the enrollment pauses and an exception is raised.
   */
  delegationValid?: boolean
  /** 2d — reason delegation failed (from delegation.ts, for escalation + audit). */
  delegationReason?: string
  /**
   * 2d(freq) — within the recipient's configured frequency caps (§9). Defaults to TRUE.
   * A false is a non-escalating DEFERRAL/suppression (held or dropped this cycle), not a
   * compliance violation — like business_hours, it does not escalate.
   */
  withinFrequencyCaps?: boolean
  /** reason the frequency cap blocked (from frequency.ts). */
  frequencyReason?: string
  /**
   * 2e — a higher-priority campaign or an active conversation is underway, so this
   * (lower-priority/promotional) send should PAUSE (§10). Defaults to FALSE (no collision).
   * A true is a non-escalating pause, not a compliance violation.
   */
  collisionPaused?: boolean
  /** reason the send was paused (from frequency.ts evaluateCollision). */
  collisionReason?: string
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
  ownership: 'Ownership could not be resolved — routed to assignment review; not sent.',
  frequency: 'Recipient frequency cap reached — held for a later cycle.',
  collision: 'A higher-priority campaign or active conversation is underway — send paused.',
  delegation: 'No active, in-scope delegation to communicate on behalf of the agency owner.',
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
function blocked(step: GateStep, escalate = true, reason?: string): GateResult {
  return { allowed: false, blockedStep: step, reason: reason ?? BLOCK[step], escalate }
}

/**
 * Run the gate. First failing step wins. Order matters: the legal quiet-hours floor
 * (2) is checked BEFORE the operator's hours of operation (2b), so a send outside the
 * TCPA floor is always a compliance block, while a send inside the floor but outside
 * business hours is a soft deferral. Every block escalates EXCEPT business_hours.
 */
export function evaluateGate(input: GateInput): GateResult {
  // 0 — ownership is a PRECONDITION: an unresolved/ambiguous owner means we cannot
  // trust any downstream signal (consent, delegation) for this contact. Route to the
  // assignment-review queue instead of sending.
  if (input.ownershipResolved === false) return blocked('ownership', true, input.ownershipConflict)
  if (!input.hasConsent) return blocked('consent')
  if (!withinQuietHours(input.recipientLocalHour)) return blocked('quiet_hours')
  if (input.withinBusinessHours === false) return blocked('business_hours', false)
  // 2c — on-behalf-of authority. Checked before content approval / recommendation:
  // a message the FSA is not authorized to send at all must never reach content checks.
  if (input.delegationValid === false) return blocked('delegation', true, input.delegationReason)
  if (input.onDNC) return blocked('dnc')
  if (!input.usesApprovedTemplateOrPolicy) return blocked('approved_template')
  if (containsRecommendationLanguage(input.draft)) return blocked('recommendation')
  if (input.isSecurity) return blocked('is_security')
  if (input.otherRuleBlocked) return blocked('other_rule')
  // 2d/2e — operational deferrals (rate caps + priority collision) are checked LAST, so
  // they only ever defer a COMPLIANCE-CLEAN send: a message that should escalate for an
  // invalid delegation / DNC / securities / recommendation surfaces + escalates first and
  // is never masked by a non-escalating deferral (§9/§10; ADR-017).
  if (input.withinFrequencyCaps === false) return blocked('frequency', false, input.frequencyReason)
  if (input.collisionPaused === true) return blocked('collision', false, input.collisionReason)
  return { allowed: true, escalate: false }
}
