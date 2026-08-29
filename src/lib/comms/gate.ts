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
  | 'message_content' // 0− — usable body + supported channel + no channel/content-type mismatch (F-2)
  | 'ownership' // 0 — authoritative ownership must resolve; unresolved → assignment review
  | 'consent' // 1
  | 'timezone_unresolved' // 1b — the recipient's zone could not be resolved; quiet hours is unevaluable
  | 'quiet_hours' // 2 — legal TCPA floor (9–20 recipient-local) on SMS marketing/campaign sends
  | 'configured_window' // 2g — operator's per-campaign / per-worker window (narrows the floor; deferral)
  | 'window_misconfigured' // 2h — configured windows cannot overlap the floor/each other; config error, escalates
  | 'business_hours' // 2b — operator's hours of operation (can only tighten the floor)
  | 'sms_live' // 2f — SMS staged pending A2P 10DLC approval (non-escalating hold)
  | 'frequency' // 2d — per-recipient rate caps (operational deferral, §9)
  | 'collision' // 2e — higher-priority campaign / active conversation underway (§10)
  | 'delegation' // 2c — FSA↔agency-owner on-behalf-of authority must be ACTIVE + in-scope
  | 'dnc' // 3
  | 'suppression' // 3b — BUSINESS suppression (agent-level book / individual client), separate from DNC
  | 'approved_template' // 4
  | 'personalization' // 4b — a required (blocking-tier) merge token did not resolve
  | 'recommendation' // 5
  | 'is_security' // 6
  | 'data_confidence' // 6b — specific claim on unverified/conflicting data (§13)
  | 'ai_authority' // 6c — §11/§12: this AI message class may not auto-send; held as a draft
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
   * 1b — the recipient's IANA timezone was RESOLVED (recipient-timezone.ts). Defaults to
   * TRUE so every existing caller — and the whole flag-off path, which evaluates in the
   * practice's own zone — is unaffected. A false is a HARD, ESCALATING block: quiet hours
   * is defined in the recipient's local time, so an unresolvable zone makes the control
   * unevaluable, and an unevaluable control must never be treated as satisfied. Checked
   * BEFORE step 2 because `recipientLocalHour` is meaningless without a resolved zone.
   *
   * This is deliberately a DISTINCT step from `quiet_hours` so reporting can separate
   * "we could not place this recipient" from "this recipient is asleep" — they need
   * different operator responses (fix the contact record vs. wait).
   */
  timezoneResolved?: boolean
  /** 1b — why the timezone did not resolve (from recipient-timezone.ts). */
  timezoneReason?: string
  /**
   * 2g — inside the operator's configured per-campaign / per-worker send window, which can
   * only NARROW the statutory floor (quiet-hours-window.ts intersects; it cannot widen).
   * Defaults to TRUE (no window configured) so behavior is unchanged until an operator
   * sets one. A false is a NON-ESCALATING deferral, like business_hours: the send is held
   * for the next opening, never suppressed and never a compliance event. This is what lets
   * a purpose with NO statutory floor (POLICY_DEADLINE, APPOINTMENT, email) carry a window
   * without that window ever becoming a suppression.
   */
  configuredWindowOk?: boolean
  /** 2g — which layer's window excluded this moment, and when it next opens. */
  configuredWindowReason?: string
  /**
   * 2h — the configured windows are UNSATISFIABLE: their intersection with the statutory
   * floor (and each other) is empty, so no instant can ever send. Defaults to false. This
   * is a HARD, ESCALATING block, deliberately distinct from `configured_window`: a window
   * miss is "wait for the opening"; an empty intersection HAS no opening, and deferring it
   * would retry forever without ever surfacing the misconfiguration to a person. The
   * operator must fix the hours policy; the send is withheld until they do.
   */
  windowMisconfigured?: boolean
  /**
   * 2 — this send is EXEMPT from the quiet-hours floor. Owner-directed scope
   * (2026-08-07): the 9:00–20:00 floor applies to SMS marketing/campaign sends only.
   * Exempt: email (all purposes), SMS with a transactional/servicing-class purpose
   * (purpose.ts quietHoursApply), and a human-typed 1:1 SMS reply on a LIVE
   * conversation (inbound from the contact within the preceding 24h — send.ts).
   * Defaults to FALSE, so every existing caller — and any unclassified send — keeps
   * the floor. This flag relaxes ONLY step 2; consent (1), DNC/STOP (3), approval (4),
   * recommendation (5), and the securities firewall (6) apply exactly as before.
   */
  quietHoursExempt?: boolean
  /**
   * 2b — inside the operator's configured hours of operation (business-local).
   * Defaults to true (no extra restriction) when omitted, so existing callers are
   * unaffected. A false here is a soft DEFERRAL (escalate=false), not a compliance
   * violation — the message is held for the next in-hours cycle, not escalated.
   */
  withinBusinessHours?: boolean
  /** 3 — on internal/external DNC. */
  onDNC: boolean
  /**
   * 3b — BUSINESS suppression: this recipient is excluded from applicable NON-transactional
   * FSOS outreach because their agent's whole book is blocked, or they are individually
   * blocked (suppression.ts resolves the effective decision from the policy layers at send
   * time). This is a SEPARATE layer from DNC (step 3) and consent (step 1): it NEVER
   * overrides or is overridden by a regulatory opt-out, and it applies to non-transactional
   * sends only (the caller passes false for transactional/servicing messages). Defaults to
   * FALSE so existing callers are unaffected. A true is a NON-escalating block (an intentional
   * operator exclusion, not a compliance violation) — audited as comms.suppressed, never sent.
   */
  businessSuppressed?: boolean
  /**
   * 3b — the effective suppression state was RELIABLY determined. Defaults to TRUE. A false is
   * the fail-closed case (a suppression lookup error/timeout/orphaned state): the send is
   * WITHHELD exactly like a positive suppression — unknown must never become allowed. Checked
   * only when the send is business-suppression-eligible (non-transactional).
   */
  suppressionResolved?: boolean
  /** 3b — which layer suppressed / why (for the audit + UI: 'individual' vs 'agent_book'). */
  suppressionReason?: string
  /** 4 — approved template or approved AI policy. */
  usesApprovedTemplateOrPolicy: boolean
  /**
   * 5 — this send uses an APPROVED, human-authored TEMPLATE (a real template id that cleared the
   * compliance/supervisor approval workflow), NOT AI-generated content. Defaults to FALSE, so the
   * recommendation red-line (step 5) applies exactly as before to AI drafts and un-templated sends.
   * When TRUE the red-line is relaxed for this send (owner decision B3-1): a licensed human authored
   * the copy and a supervisor approved it, so ordinary suggestive marketing wording ("a term policy
   * may be a great fit") is permitted. This NEVER relaxes the securities firewall (step 6,
   * `isSecurity`), consent, DNC, approval, or any other step — only the individualized-recommendation
   * wording check, and only for supervisor-approved human templates.
   */
  approvedHumanTemplate?: boolean
  /**
   * 4b — every BLOCKING-tier merge token the body references resolved (advisor/agency identity,
   * the unsubscribe/scheduling links, and booking specifics). Defaults to TRUE so existing
   * callers are unaffected. A false is a HARD block that ESCALATES: a message missing required
   * identity/opt-out/booking content is never shipped with an empty placeholder — it is routed
   * to the human FSA. Computed at send time from personalize.unresolvedBlockingTokens (§13).
   */
  personalizationResolved?: boolean
  /** 4b — which required merge tokens did not resolve (for the escalation + audit). */
  personalizationReason?: string
  /** 6 — record/recipient securities-flagged. */
  isSecurity: boolean
  /**
   * 2f — the SMS channel is live: A2P 10DLC brand/campaign is APPROVED. Defaults to TRUE
   * so email and existing callers are unaffected (email is never A2P-gated). For an SMS
   * send the dispatcher passes the current A2P-approved flag; a false is a NON-escalating
   * HOLD (like business_hours) — the SMS is queued, never sent, and auto-activates the
   * moment the flag flips true. This is the single code gate that prevents any SMS reaching
   * real contacts before A2P approval (§12, twilio-a2p-compliance).
   */
  smsLive?: boolean
  /**
   * 6b — the message's specific claims rest on VERIFIED/confident data (§13). Defaults to
   * TRUE. A false HARD-blocks + escalates: the contact is excluded and a verification task
   * is raised — never sent on unverified/conflicting data.
   */
  dataConfidenceOk?: boolean
  /** 6b — reason data confidence failed (from data-confidence.ts, for the verification task). */
  dataConfidenceReason?: string
  /**
   * 6c — §11/§12 AI authority. Defaults to TRUE (not an AI send, or cleared to auto-send).
   * A false is a HARD, ESCALATING block: the draft is held for the licensed FSA rather than
   * auto-sent. Evaluated at the chokepoint alongside consent and template approval, because
   * evaluateAiAuthority needs both and re-reading them in a second layer is how two layers
   * come to disagree.
   */
  aiAuthorityOk?: boolean
  /** 6c — which §12 checks failed / the resolved authority, for the draft + escalation. */
  aiAuthorityReason?: string
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
  message_content: 'Message has no usable body, an unsupported channel, or a channel/content-type mismatch — not sent.',
  ownership: 'Ownership could not be resolved — routed to assignment review; not sent.',
  frequency: 'Recipient frequency cap reached — held for a later cycle.',
  collision: 'A higher-priority campaign or active conversation is underway — send paused.',
  delegation: 'No active, in-scope delegation to communicate on behalf of the agency owner.',
  consent: 'No valid channel consent on file.',
  timezone_unresolved: 'Recipient timezone could not be resolved — quiet hours cannot be evaluated; not sent.',
  quiet_hours: 'Outside permitted quiet hours (9:00–20:00 recipient-local).',
  configured_window: 'Outside the configured send window — held for the next opening.',
  window_misconfigured: 'The configured send windows never overlap the permitted hours — nothing can ever send; fix the hours policy.',
  business_hours: 'Outside configured hours of operation — held for the next in-hours cycle.',
  sms_live: 'SMS is staged pending A2P 10DLC approval — held until the campaign is approved.',
  dnc: 'Recipient is on the do-not-contact list.',
  suppression: 'Recipient is excluded from applicable outreach by agent-level or individual communication suppression.',
  approved_template: 'Message does not use an approved template or AI policy.',
  personalization: 'A required merge token did not resolve — held for the FSA to complete.',
  recommendation: 'Message contains individualized recommendation / call-to-action language.',
  is_security: 'Securities-flagged record — excluded from automation; route to FFS-supervised handling.',
  data_confidence: 'Specific claim rests on unverified/conflicting data — excluded; verification task raised.',
  ai_authority: 'AI message is not cleared to auto-send — drafted for the licensed FSA.',
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
  // 0− CONTENT INTEGRITY (audit finding F-2) — the architectural backstop that makes an
  // invalid message impossible to dispatch, regardless of which caller produced it. Checked
  // FIRST so no downstream step can mask it and no code path can ship:
  //   • an unsupported channel (only 'sms'/'email' reach a provider),
  //   • an empty or whitespace-only body (the 67 blank email-as-SMS incident: an email
  //     template resolved to SMS with body ''), or
  //   • email/HTML content routed to the SMS channel (a template-channel mismatch).
  // Escalating hard block — never a silent drop. NOTE: for SMS the dispatcher appends the
  // opt-out footer AFTER the gate, so this validates the ACTUAL authored body (the footer can
  // never turn an empty message into a "non-empty" one that slips past a downstream check).
  if (input.channel !== 'sms' && input.channel !== 'email') {
    return blocked('message_content', true, `Unsupported channel "${String((input as { channel?: unknown }).channel)}".`)
  }
  const body = typeof input.draft === 'string' ? input.draft : ''
  if (body.trim() === '') {
    return blocked('message_content', true, `Empty ${input.channel} body — nothing to send.`)
  }
  if (input.channel === 'sms' && /<!doctype html|<html[\s>]|<\/html>|<body[\s>]|<table[\s>]/i.test(body)) {
    return blocked('message_content', true, 'HTML/email content resolved onto the SMS channel — template/channel mismatch.')
  }
  // 0 — ownership is a PRECONDITION: an unresolved/ambiguous owner means we cannot
  // trust any downstream signal (consent, delegation) for this contact. Route to the
  // assignment-review queue instead of sending.
  if (input.ownershipResolved === false) return blocked('ownership', true, input.ownershipConflict)
  if (!input.hasConsent) return blocked('consent')
  // The LEGAL TCPA quiet-hours floor (escalating) stays early. The operator's own hours
  // of operation (business_hours) is a NON-escalating operational deferral and is checked
  // LAST with frequency/collision — never here — so a firewall / DNC / recommendation /
  // delegation / data-confidence trip evaluated outside operating hours still surfaces as
  // its own escalating block and is not masked as a benign "held for hours" deferral
  // (§13.9: never silently downgrade a compliance control).
  // 1b — an unresolvable recipient timezone makes the quiet-hours floor UNEVALUABLE.
  // Fail closed and escalate: never treat an uncheckable control as satisfied. Checked
  // before step 2 because recipientLocalHour carries no meaning without a resolved zone.
  // Skipped for a send the floor does not reach AND that carries no configured window —
  // there is nothing a zone would be used for there (see quiet-hours-window.ts).
  if (input.timezoneResolved === false) {
    return blocked('timezone_unresolved', true, input.timezoneReason)
  }
  if (input.quietHoursExempt !== true && !withinQuietHours(input.recipientLocalHour)) {
    return blocked('quiet_hours')
  }
  // 2c — on-behalf-of authority. Checked before content approval / recommendation:
  // a message the FSA is not authorized to send at all must never reach content checks.
  if (input.delegationValid === false) return blocked('delegation', true, input.delegationReason)
  if (input.onDNC) return blocked('dnc')
  // 3b — BUSINESS suppression (agent-level book / individual client). Ordered right AFTER the
  // regulatory DNC step and BEFORE content/campaign checks, matching the required decision
  // order: consent → DNC/STOP → individual suppression → agent/book suppression → campaign
  // eligibility. This is a business exclusion, not a compliance violation, so it does NOT
  // escalate (avoids flooding the FSA queue when a whole book is blocked) — but it is still a
  // hard withhold that is audited (comms.suppressed) and never sent. The resolver applies the
  // individual→agent ordering, so `suppressionReason` already names the winning layer.
  // Fail-closed first: an undetermined suppression state withholds the send just like a
  // positive one — unknown must never become allowed.
  if (input.suppressionResolved === false) {
    return blocked('suppression', false, input.suppressionReason ?? 'Effective suppression could not be determined — fail closed.')
  }
  if (input.businessSuppressed === true) return blocked('suppression', false, input.suppressionReason)
  if (!input.usesApprovedTemplateOrPolicy) return blocked('approved_template')
  // 4b — content integrity: a required (blocking-tier) merge token that did not resolve means the
  // body would ship with an empty placeholder (a blank appointment time, a missing opt-out or
  // manage link, absent advisor/agency identity). Escalating hard block — never sent, routed to
  // the FSA to complete (§13; personalize.unresolvedBlockingTokens is the send-time source).
  if (input.personalizationResolved === false) return blocked('personalization', true, input.personalizationReason)
  // 5 — individualized recommendation / call-to-action red-line. Relaxed ONLY for a supervisor-
  // approved, human-authored template (B3-1): the human author + approval workflow is the accountable
  // control there, so ordinary suggestive marketing copy is allowed. AI-generated and un-templated
  // sends still get the full red-line. The securities firewall below is unaffected.
  if (!input.approvedHumanTemplate && containsRecommendationLanguage(input.draft)) return blocked('recommendation')
  if (input.isSecurity) return blocked('is_security')
  // 6b — a specific claim on unverified/conflicting data (§13). Escalates: exclude the
  // contact + raise a verification task; never send on a guess.
  if (input.dataConfidenceOk === false) return blocked('data_confidence', true, input.dataConfidenceReason)
  // 6c — §11/§12: an AI message whose class is not cleared to auto-send is HELD as a draft
  // for the licensed FSA. Checked after the firewall and the red line so a securities or
  // recommendation trip still surfaces as its own block rather than a generic AI hold.
  if (input.aiAuthorityOk === false) return blocked('ai_authority', true, input.aiAuthorityReason)
  if (input.otherRuleBlocked) return blocked('other_rule')
  // 2b/2f/2d/2e — operational deferrals (SMS-A2P hold, business hours, rate caps, priority
  // collision) are checked LAST, so they only ever defer a COMPLIANCE-CLEAN send: a message
  // that should escalate for an invalid delegation / DNC / securities / recommendation /
  // data-confidence issue surfaces + escalates first and is never masked by a non-escalating
  // deferral (§9/§10; ADR-017). business_hours can only TIGHTEN the legal quiet-hours floor.
  //
  // 2f — SMS-A2P hold is FIRST among the deferrals so a staged SMS clearly reads "pending
  // A2P approval" rather than a later deferral reason. Non-escalating: the SMS is held and
  // retried each cycle, activating automatically when the A2P flag flips true (§12).
  if (input.smsLive === false) return blocked('sms_live', false)
  if (input.withinBusinessHours === false) return blocked('business_hours', false)
  // 2h — an EMPTY window intersection is a configuration error, not a deferral: there is no
  // "next opening" to hold for, so deferring would silently retry forever. Escalates so an
  // operator fixes the policy. Checked before the configured_window deferral so an
  // unsatisfiable config never masquerades as an ordinary hold.
  if (input.windowMisconfigured === true) return blocked('window_misconfigured', true, input.configuredWindowReason)
  // 2g — the operator's per-campaign / per-worker window. A DEFERRAL, never a suppression:
  // it is an operator preference narrowing the floor, not a regulatory control, so a miss
  // holds the send for the next opening exactly like business_hours.
  if (input.configuredWindowOk === false) return blocked('configured_window', false, input.configuredWindowReason)
  if (input.withinFrequencyCaps === false) return blocked('frequency', false, input.frequencyReason)
  if (input.collisionPaused === true) return blocked('collision', false, input.collisionReason)
  return { allowed: true, escalate: false }
}

/**
 * The NON-ESCALATING gate steps: operational deferrals, not compliance verdicts. A send
 * withheld on one of these is a HOLD — the condition clears on its own (the clock reaches
 * the window, A2P approval lands, the frequency day rolls over) — so the caller that owns
 * the message's schedule must RE-ATTEMPT it rather than terminally marking it. This set is
 * the single source of truth for that retry decision; the campaign ticks, the workforce
 * queue, the workshop engine, and the message-status UI all key off it, so a new deferral
 * step added to the union cannot silently become terminal in one consumer and retryable in
 * another. NOTE: `suppression` is escalate=false but is NOT here — a business exclusion is
 * an intentional operator decision, not a self-clearing hold.
 */
export const DEFERRAL_GATE_STEPS: ReadonlySet<GateStep> = new Set<GateStep>([
  'sms_live',
  'business_hours',
  'frequency',
  'collision',
  'configured_window',
])

/** True when a blocked step is an operational deferral the schedule owner should retry. */
export function isDeferralGateStep(step: string | null | undefined): boolean {
  return !!step && DEFERRAL_GATE_STEPS.has(step as GateStep)
}
