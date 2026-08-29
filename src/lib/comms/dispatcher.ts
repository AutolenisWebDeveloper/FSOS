// src/lib/comms/dispatcher.ts
// The dispatcher is now a THIN FORWARDER onto the chokepoint (lib/messaging.ts), not a
// gate layer of its own.
//
// WHAT CHANGED AND WHY. This file used to run `evaluateGate` on a context its CALLER had
// computed, then call the provider. That made it the enforcement point for the eighteen
// callers that came through `sendThroughGate` — and for nobody else. Nine other paths
// reached Resend without passing through here at all. Enforcement therefore moved to
// `messaging.sendSms` / `messaging.sendEmail`, which is the only code in FSOS that can
// reach a provider, and this module stopped evaluating anything.
//
// Keeping ONE evaluation matters as much as moving it. Two gate evaluations on two
// different contexts is how a system ends up with checks that disagree — the caller's
// snapshot says consented, the fresh read says revoked, and which one wins depends on
// which layer you read. The chokepoint resolves everything fresh at the moment of dispatch
// and is the single authority.
//
// CALLER-ASSERTED CONTEXT IS ENRICHMENT, NOT PERMISSION. `DispatchRequest.gate` is
// forwarded ONLY for the fields a caller legitimately owns — the message's purpose, its
// template, its securities flag, its ownership and delegation findings, its personalization
// and data-confidence results. Consent, DNC, suppression, quiet hours and the A2P hold are
// deliberately NOT forwarded: those are resolved fresh at the chokepoint, so a caller
// asserting `hasConsent: true` cannot manufacture consent. The firewall flag is forwarded
// because it can only ever make the send MORE restrictive (the chokepoint ORs it with the
// server-resolved conversation flag).

import type { GateInput, GateResult } from './gate'
import type { SendResult, SendPolicyOptions } from '../messaging'
import type { EmailStream } from './senders'
import type { SuppressionSubject } from './suppression'
import type { TemplateKind } from './dispatch-policy'

export interface DispatchRequest {
  channel: 'sms' | 'email'
  to: string
  /** email only */
  subject?: string
  /** The AUTHORED body. The SMS opt-out footer is appended at the chokepoint, after checks. */
  body: string
  /** email only — the stored plaintext part (multipart). */
  bodyText?: string
  /**
   * Caller-computed context. Only the caller-owned fields are forwarded (see the header);
   * the regulatory reads are performed fresh at the chokepoint regardless of what is here.
   */
  gate: Omit<GateInput, 'draft' | 'channel'>
  actor: string
  entity?: { type: string; id: string }
  escalationNote?: string
  messageClass?: EmailStream
  /** Retained for callers that still name a suppression subject; the chokepoint re-resolves. */
  suppressionSubject?: SuppressionSubject
  correlationId?: string
  /** How gate step 4 is satisfied for this send. */
  templateKind?: TemplateKind
  /** Recipient linkage, when the caller knows it (the chokepoint resolves it otherwise). */
  memberId?: string | null
  householdId?: string | null
  agencyId?: string | null
  conversationId?: string | null
  /** Scope keys for the configured per-campaign / per-worker send window. */
  campaignKey?: string | null
  workerKey?: string | null
  /** Timezone hints (the workshop engine resolves its own). */
  utcOffsetHours?: number
  timeZone?: string
  /**
   * Caller-owned policy context forwarded verbatim to the chokepoint: the message's purpose
   * and template, its AI classification, and the caller-verified consent signals (a durable
   * domain grant, the console waiver). These are DECLARATIONS about the message, not
   * verdicts about the recipient — the chokepoint still performs every recipient read
   * itself and can only end up more restrictive than what is asserted here.
   */
  policy?: Partial<SendPolicyOptions>
}

export interface DispatchResult {
  sent: boolean
  gate: GateResult
  escalated: boolean
  providerId?: string
  error?: string
  /** The EXACT body transmitted (SMS carries the appended opt-out footer). */
  sentBody?: string
  /** Timezone resolution used for the quiet-hours decision (persisted on the send record). */
  timezone?: SendResult['timezone']
  /** Recipient linkage + consent/DNC/suppression as the chokepoint actually resolved them. */
  resolved?: SendResult['resolved']
}

/**
 * Forward one message to the chokepoint. The gate decision, the escalation, the audit and
 * the opt-out footer all happen there; this function only maps the request shape and maps
 * the result back for existing callers.
 */
export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  const { sendSms, sendEmail } = await import('../messaging')

  const policy: SendPolicyOptions = {
    ...(req.policy ?? {}),
    actor: req.actor,
    entity: req.entity,
    memberId: req.memberId ?? null,
    householdId: req.householdId ?? null,
    agencyId: req.agencyId ?? null,
    conversationId: req.conversationId ?? null,
    templateKind: req.templateKind,
    campaignKey: req.campaignKey ?? null,
    workerKey: req.workerKey ?? null,
    utcOffsetHours: req.utcOffsetHours,
    timeZone: req.timeZone,
    // Caller-owned findings only — never the regulatory reads.
    isSecurity: req.gate.isSecurity === true,
    ownershipResolved: req.gate.ownershipResolved,
    ownershipConflict: req.gate.ownershipConflict,
    delegationValid: req.gate.delegationValid,
    delegationReason: req.gate.delegationReason,
    personalizationResolved: req.gate.personalizationResolved,
    personalizationReason: req.gate.personalizationReason,
    dataConfidenceOk: req.gate.dataConfidenceOk,
    dataConfidenceReason: req.gate.dataConfidenceReason,
  }

  const result: SendResult =
    req.channel === 'sms'
      ? await sendSms(req.to, req.body, req.correlationId, { policy })
      : await sendEmail(req.to, req.subject ?? '', req.body, req.bodyText, {
          policy,
          ...(await resolveEmailEnvelope(req)),
        })

  const gate: GateResult = result.blocked
    ? { allowed: false, blockedStep: result.blockedStep as GateResult['blockedStep'], reason: result.reason, escalate: result.escalated === true }
    : { allowed: true, escalate: false }

  return {
    sent: result.ok,
    gate,
    escalated: result.escalated === true,
    providerId: result.id,
    error: result.error,
    sentBody: result.sentBody,
    timezone: result.timezone,
    resolved: result.resolved,
  }
}

/** Envelope-From / reply-to / List-Unsubscribe headers for an outbound email. */
async function resolveEmailEnvelope(req: DispatchRequest): Promise<{
  from?: string
  replyTo?: string
  headers?: Record<string, string>
}> {
  try {
    const { emailListUnsubscribeHeaders, replyToAddress } = await import('./unsubscribe')
    const { resolveSender } = await import('./senders')
    const sender = resolveSender(req.messageClass ?? 'marketing')
    return {
      from: sender.from || undefined,
      replyTo: sender.replyTo || replyToAddress(),
      headers: {
        ...emailListUnsubscribeHeaders(req.to),
        ...(req.correlationId ? { 'X-FSOS-Message-Id': req.correlationId } : {}),
      },
    }
  } catch {
    return {}
  }
}
