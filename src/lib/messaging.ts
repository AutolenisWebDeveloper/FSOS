// src/lib/messaging.ts
// THE DISPATCH CHOKEPOINT. One send path per channel, and every policy check that governs
// an outbound message runs here, immediately before the irreversible provider call.
//
// WHY HERE. This is the only file in FSOS that touches Resend or api.twilio.com. Phase A
// found eighteen call sites routed through the old `sendThroughGate` wrapper and NINE that
// were not — transactional acknowledgements, a booking fallback, a password-setup mail, a
// form-link email, an AI briefing — each sending with no consent read, no DNC check, no
// suppression, and no audit. A gate a caller can decline to call is a convention, not a
// control. Both facts pointed at the same fix: put the enforcement where the provider is,
// because that is the one place nothing can route around.
//
// WHAT RUNS HERE, ON EVERY SEND, ENRICHED CALLER OR BARE:
//   consent · DNC/STOP · business suppression · quiet hours (recipient-local, configurable)
//   · approved template or policy · the no-recommendation red line · the securities firewall
//   · A2P 10DLC hold · frequency + collision · content integrity — then escalation.
//
// THE THREE INVARIANTS THIS FILE IS ACCOUNTABLE FOR:
//
//   1. NO BYPASS. There is no parameter, flag, or caller shape that skips
//      `resolveDispatchPolicy`. A caller that supplies no context gets MORE scrutiny, not
//      less: everything is resolved from the destination address.
//   2. NO BARE `{ ok: false }`. Every withheld send returns a structured result naming the
//      step and reason, AND is audited — escalating to the human FSA when it is a
//      compliance block rather than an operational deferral. A boundary that could block
//      silently would satisfy the gate's letter and break its purpose.
//   3. CONTENT CHECKS SEE THE AUTHORED BODY. The SMS opt-out footer is appended HERE, after
//      the checks, never before. Appending first would make the empty-body check
//      unreachable — the footer alone makes any body non-empty — silently disarming the
//      control that exists because 67 clients once received a blank SMS.

import {
  resolveDispatchPolicy,
  type DispatchPolicyContext,
  type DispatchPolicyDecision,
} from './comms/dispatch-policy'
import { escalateBlockedSend, auditSentMessage, type EscalationContext, type BlockOutcome } from './comms/escalation'
import { SMS_OPT_OUT_FOOTER } from './compliance'

export interface SendResult {
  ok: boolean
  id?: string
  error?: string
  skipped?: boolean
  /** True when policy withheld the send (as opposed to a provider/config failure). */
  blocked?: boolean
  /** The gate step that withheld it — never absent on a blocked result. */
  blockedStep?: string
  /** Operator-facing reason. */
  reason?: string
  /** Whether this block was raised to the human-FSA queue. */
  escalated?: boolean
  /** The exact body transmitted (SMS includes the appended opt-out footer). */
  sentBody?: string
  /** Timezone resolution actually used, for the send record (step 5). */
  timezone?: DispatchPolicyDecision['timezone']
  /**
   * What the chokepoint actually resolved — recipient linkage plus the consent/DNC/
   * suppression verdicts. Returned so the message-preparation layer can persist
   * `consent_at_send` from the SAME read the decision was made on, rather than issuing a
   * second read that could disagree with it.
   */
  resolved?: DispatchPolicyDecision['resolved']
}

/**
 * The policy context a caller supplies. Everything is optional: an absent field is
 * RESOLVED, never assumed. `actor` should always be set so a block is attributable.
 */
export type SendPolicyOptions = Omit<DispatchPolicyContext, 'channel' | 'to' | 'body' | 'actor'> & {
  actor?: string
}

export function emailConfigured(): boolean {
  const from = process.env.RESEND_FROM_EMAIL
  return !!process.env.RESEND_API_KEY && !!from && !/yourdomain\.com/i.test(from)
}

export function smsConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
}

/** Optional per-send email delivery options (deliverability: reply routing + headers). */
/** One email attachment (base64 content — e.g. the workshop .ics calendar file). */
export interface EmailAttachment {
  filename: string
  /** Base64-encoded file content. */
  content: string
  contentType?: string
}

export interface EmailSendOptions {
  from?: string
  replyTo?: string
  headers?: Record<string, string>
  /** File attachments (WS-022: the .ics on the workshop instant ack). */
  attachments?: EmailAttachment[]
  /** Dispatch policy context. Absent → everything is resolved from the address. */
  policy?: SendPolicyOptions
}

export interface SmsSendOptions {
  /** Dispatch policy context. Absent → everything is resolved from the number. */
  policy?: SendPolicyOptions
}

// ─────────────────────────────────────────────────────────────────────────────
// Injectable seam — mirrors dispatcher.ts's `deps` pattern so the chokepoint's
// block-and-escalate behavior is deterministically testable without a DB or a provider.
// ─────────────────────────────────────────────────────────────────────────────

export interface MessagingDeps {
  resolvePolicy(ctx: DispatchPolicyContext): Promise<DispatchPolicyDecision>
  escalate(ctx: EscalationContext, outcome: BlockOutcome, extra?: Record<string, unknown>): Promise<void>
  auditSent(ctx: EscalationContext, result: { ok: boolean; id?: string; error?: string }): Promise<void>
  deliverEmail(args: {
    to: string; from: string; subject: string; html: string; text?: string
    replyTo?: string; headers?: Record<string, string>; apiKey: string
    attachments?: EmailAttachment[]
  }): Promise<SendResult>
  deliverSms(args: {
    to: string; body: string; sid: string; token: string
    from?: string; messagingServiceSid?: string; statusCallback?: string
  }): Promise<SendResult>
}

export const defaultMessagingDeps: MessagingDeps = {
  /**
   * FAIL CLOSED ON A THROW. Every reader inside resolveDispatchPolicy already returns the
   * restrictive answer on error, but an unexpected exception (a missing module, an OOM, a
   * bad env) must not escape into the caller either: a caller that catches a throw and
   * carries on would turn an unevaluated policy into a send. A thrown resolution becomes a
   * hard, escalating block instead.
   */
  async resolvePolicy(ctx) {
    try {
      return await resolveDispatchPolicy(ctx)
    } catch (err) {
      const reason = `Dispatch policy could not be evaluated — send withheld (${err instanceof Error ? err.message : String(err)}).`
      return {
        gate: { allowed: false, blockedStep: 'other_rule', reason, escalate: true },
        allowed: false,
        timezone: {
          resolution: { resolved: false, reason: 'no_input', attempted: [] },
          zone: null, localHour: null, localDay: null, secondaryZone: null, legacy: false,
        },
        resolved: { memberId: null, householdId: null, agencyId: null, consent: false, onDNC: true, suppressed: true },
      }
    }
  },
  escalate: (ctx, outcome, extra) => escalateBlockedSend(ctx, outcome, extra),
  auditSent: (ctx, result) => auditSentMessage(ctx, result),
  async deliverEmail({ to, from, subject, html, text, replyTo, headers, apiKey, attachments }) {
    // CAPTURED TRANSPORT (test-only). Placed HERE, inside the delivery seam, so every
    // step above it still runs — policy resolution, the gate, quiet hours, escalation —
    // and only the provider call itself is replaced. A capture-write failure FAILS THE
    // SEND; it never falls through to Resend. Refuses to activate in production.
    {
      const { captureActive, captureMessage } = await import('./comms/capture-transport')
      if (captureActive()) {
        const ok = captureMessage({
          at: new Date().toISOString(),
          channel: 'email',
          to,
          subject,
          body: html,
          bodyText: text,
          attachments: attachments?.map((a) => a.filename),
        })
        return ok ? { ok: true, id: `captured_${Date.now()}` } : { ok: false, error: 'capture_write_failed' }
      }
    }
    try {
      // Lazily imported so THIS FILE stays loadable without the provider SDK. That matters
      // now that it is the chokepoint: the offline test harness compiles and requires this
      // module to exercise the gate, and a top-level `require('resend')` made that
      // impossible. Same technique dispatcher.ts uses for its heavy dependencies.
      const { Resend } = await import('resend')
      const resend = new Resend(apiKey)
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
        ...(headers ? { headers } : {}),
        ...(attachments?.length ? { attachments } : {}),
      })
      if (error) return { ok: false, error: error.message || String(error) }
      return { ok: true, id: data?.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
  async deliverSms({ to, body, sid, token, from, messagingServiceSid, statusCallback }) {
    // CAPTURED TRANSPORT — same contract as deliverEmail above: last step before the
    // provider, fails the send on a capture-write failure, inert in production.
    {
      const { captureActive, captureMessage } = await import('./comms/capture-transport')
      if (captureActive()) {
        const ok = captureMessage({ at: new Date().toISOString(), channel: 'sms', to, body })
        return ok ? { ok: true, id: `SMcaptured${Date.now()}` } : { ok: false, error: 'capture_write_failed' }
      }
    }
    try {
      const params: Record<string, string> = { To: to, Body: body }
      if (messagingServiceSid) params.MessagingServiceSid = messagingServiceSid
      else if (from) params.From = from
      if (statusCallback) params.StatusCallback = statusCallback
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params),
      })
      if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` }
      const json = (await res.json().catch(() => ({}))) as { sid?: string }
      return { ok: true, id: json.sid }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared withholding path — the reason there is no bare `{ ok: false }` in this file
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Withhold a send: audit it, escalate it when it is a compliance block, and return a
 * structured result. EVERY non-send in this file goes through here — policy blocks and
 * configuration failures alike — so a caller can never receive an unexplained false.
 *
 * Configuration failures (`escalate: false`) are audited as operational deferrals rather
 * than raised to the FSA: a missing API key in a misconfigured environment is for the
 * operator to fix, and escalating it per-send would bury the real compliance blocks.
 */
async function withhold(
  deps: MessagingDeps,
  ctx: EscalationContext,
  outcome: BlockOutcome,
  extra: Record<string, unknown> = {},
): Promise<SendResult> {
  await deps.escalate(ctx, outcome, extra)
  return {
    ok: false,
    blocked: true,
    blockedStep: String(outcome.blockedStep),
    reason: outcome.reason,
    escalated: outcome.escalate,
    // `error` carries the same text so existing callers that only read `.error` keep
    // working; `blockedStep` is the structured field to branch on.
    error: outcome.reason,
  }
}

function escalationCtx(
  channel: 'sms' | 'email',
  to: string,
  body: string,
  policy: SendPolicyOptions | undefined,
): EscalationContext {
  return {
    channel,
    to,
    body,
    actor: policy?.actor ?? 'system',
    entity: policy?.entity,
    note: policy?.templateKind ? `templateKind:${policy.templateKind}` : undefined,
  }
}

/** Build the full policy context from the caller's (possibly absent) enrichment. */
function policyContext(
  channel: 'sms' | 'email',
  to: string,
  body: string,
  policy: SendPolicyOptions | undefined,
): DispatchPolicyContext {
  return {
    ...(policy ?? {}),
    channel,
    to,
    body,
    actor: policy?.actor ?? 'system',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────────────

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  opts?: EmailSendOptions,
  deps: MessagingDeps = defaultMessagingDeps,
): Promise<SendResult> {
  const ctx = escalationCtx('email', to, html, opts?.policy)

  // Addressability first — policy cannot be resolved without a recipient.
  if (!to) {
    return withhold(deps, ctx, { blockedStep: 'no_recipient', reason: 'No recipient email.', escalate: false })
  }

  // ── CONTENT INTEGRITY on the authored body (the email sibling of the SMS guards below). ──
  if (!html || html.trim() === '') {
    return withhold(deps, ctx, { blockedStep: 'message_content', reason: 'empty_email_body', escalate: true })
  }

  // ── POLICY, BEFORE CONFIGURATION. Deliberate ordering: whether this message is ALLOWED
  //    is independent of whether a provider happens to be configured. Checking config first
  //    would report "RESEND_API_KEY not set" for a message that is in fact blocked because
  //    the recipient is on DNC — hiding a compliance verdict behind an environment problem,
  //    and making the real reason invisible in every environment that lacks credentials. ──
  const decision = await deps.resolvePolicy(policyContext('email', to, html, opts?.policy))
  if (!decision.allowed) {
    return {
      ...(await withhold(
        deps,
        ctx,
        {
          blockedStep: decision.gate.blockedStep ?? 'other_rule',
          reason: decision.gate.reason ?? 'Withheld by the dispatch gate.',
          escalate: decision.gate.escalate,
        },
        {
          timezone: decision.timezone.resolution,
          resolvedZone: decision.timezone.zone,
          quietHours: decision.quietHours?.outcome,
          hoursUntilOpen: decision.quietHours?.hoursUntilOpen ?? null,
        },
      )),
      timezone: decision.timezone,
      resolved: decision.resolved,
    }
  }

  // ── Configuration. Only now, once the message is cleared to send. ──
  const apiKey = process.env.RESEND_API_KEY
  const from = opts?.from || process.env.RESEND_FROM_EMAIL
  if (!apiKey) {
    return withhold(deps, ctx, { blockedStep: 'not_configured', reason: 'RESEND_API_KEY not set.', escalate: false })
  }
  if (!from || /yourdomain\.com/i.test(from)) {
    return withhold(deps, ctx, { blockedStep: 'not_configured', reason: 'RESEND_FROM_EMAIL not a verified sender.', escalate: false })
  }

  const replyTo = opts?.replyTo || process.env.RESEND_REPLY_TO || undefined
  const result = await deps.deliverEmail({
    to, from, subject, html, text, replyTo, headers: opts?.headers, apiKey,
    attachments: opts?.attachments,
  })
  await deps.auditSent(ctx, result)
  return { ...result, sentBody: result.ok ? html : undefined, timezone: decision.timezone, resolved: decision.resolved }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────────────────────────

/** Absolute base URL for building Twilio status-callback links (best-effort). */
function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    ''
  return raw.replace(/\/$/, '')
}

export async function sendSms(
  to: string,
  body: string,
  correlationId?: string,
  opts?: SmsSendOptions,
  deps: MessagingDeps = defaultMessagingDeps,
): Promise<SendResult> {
  // `body` here is the AUTHORED body. The opt-out footer is appended at the very end of
  // this function, AFTER every check — see invariant 3 in the file header.
  const ctx = escalationCtx('sms', to, body, opts?.policy)

  if (!to) {
    return withhold(deps, ctx, { blockedStep: 'no_recipient', reason: 'No recipient phone.', escalate: false })
  }

  // ── CONTENT INTEGRITY, on the AUTHORED body, before anything else touches it. ──
  // These are intrinsic to the message — they need no recipient state — so they run before
  // the policy reads rather than after. The gate checks the same things (step
  // `message_content`); this is the provider-boundary backstop that made the 67-client
  // blank-SMS incident impossible to repeat, and it is positioned so it can never be
  // defeated by the opt-out footer appended at the end of this function.
  if (!body || body.trim() === '') {
    return withhold(deps, ctx, { blockedStep: 'message_content', reason: 'empty_sms_body', escalate: true })
  }
  if (/<!doctype html|<html[\s>]|<\/html>|<body[\s>]|<table[\s>]/i.test(body)) {
    return withhold(deps, ctx, { blockedStep: 'message_content', reason: 'html_body_in_sms', escalate: true })
  }

  // ── POLICY, BEFORE CONFIGURATION (see the email path for the rationale). The A2P 10DLC hold is enforced inside the gate (step `sms_live`), so it is
  //    part of this one decision rather than a separate pre-check that could drift. ──
  const decision = await deps.resolvePolicy(policyContext('sms', to, body, opts?.policy))
  if (!decision.allowed) {
    return {
      ...(await withhold(
        deps,
        ctx,
        {
          blockedStep: decision.gate.blockedStep ?? 'other_rule',
          reason: decision.gate.reason ?? 'Withheld by the dispatch gate.',
          escalate: decision.gate.escalate,
        },
        {
          timezone: decision.timezone.resolution,
          resolvedZone: decision.timezone.zone,
          quietHours: decision.quietHours?.outcome,
          hoursUntilOpen: decision.quietHours?.hoursUntilOpen ?? null,
        },
      )),
      // The A2P hold keeps its historical `skipped` shape so the callers that count held
      // SMS separately from failures continue to do so.
      skipped: decision.gate.blockedStep === 'sms_live' ? true : undefined,
      timezone: decision.timezone,
      resolved: decision.resolved,
    }
  }

  // ── Configuration. Only now, once the message is cleared to send. ──
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  if (!sid || !token || (!from && !messagingServiceSid)) {
    return withhold(deps, ctx, { blockedStep: 'not_configured', reason: 'Twilio env not set.', escalate: false })
  }

  // ── FOOTER LAST. Every content check above saw the authored body; the carrier-required
  //    opt-out keyword is appended only once the message is cleared to send. ──
  // WS-069 — appended ONCE. A template whose authored body already instructs "Reply STOP"
  // (the six booking bodies) is authoritative; stacking a second STOP line onto it was the
  // defect this branch fixed, and the footer moving to the chokepoint must not reinstate it.
  // Bodies without it (the workshop templates) keep the auto-appended footer exactly as before.
  const wireBody = /reply\s+stop/i.test(body) ? body : `${body}\n\n${SMS_OPT_OUT_FOOTER}`

  const base = appBaseUrl()
  const statusCallback = base
    ? correlationId
      ? `${base}/api/webhooks/twilio/status?mid=${encodeURIComponent(correlationId)}`
      : `${base}/api/webhooks/twilio/status`
    : undefined

  const result = await deps.deliverSms({
    to, body: wireBody, sid, token, from, messagingServiceSid, statusCallback,
  })
  await deps.auditSent(ctx, result)
  return { ...result, sentBody: result.ok ? wireBody : undefined, timezone: decision.timezone, resolved: decision.resolved }
}
