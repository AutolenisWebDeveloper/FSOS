// src/lib/comms/dispatcher.ts
// GUARDRAIL 3 (execution) — the communications dispatcher. The single send path
// for every automated SMS/email. It runs the pure 7-step gate (gate.ts), and:
//   • on ALLOW  → sends via the existing messaging senders + audits comms.sent
//   • on BLOCK  → writes a compliance_event, creates a human-FSA escalation, and
//                 audits comms.blocked/firewall.blocked — NEVER sends, NEVER
//                 silently drops.
// There is deliberately no "force send" path (WF-5 invariant). The enforcement
// DECISION lives in gate.ts (pure); the side-effects are behind an injectable
// `deps` seam (default = the real Supabase/messaging writes) so the block-and-
// escalate behavior is deterministically testable without a live DB.
import { evaluateGate, type GateInput, type GateResult } from './gate'
import { SMS_OPT_OUT_FOOTER } from '../compliance'
import type { AuditEntry } from '../audit/log'
import type { SendResult } from '../messaging'
import type { EmailStream } from './senders'
import type { SuppressionSubject, SuppressionDecision } from './suppression'

export interface DispatchRequest {
  channel: 'sms' | 'email'
  to: string
  /** email only */
  subject?: string
  body: string
  /** email only — the stored plaintext part (multipart). Absent → single-part HTML send. */
  bodyText?: string
  /** Gate context (computed by the caller/job from consents/DNC/state rules). */
  gate: Omit<GateInput, 'draft' | 'channel'>
  /** Who/what initiated (user id, "agent:pipeline", "system"). */
  actor: string
  /** Entity this send is about, for audit + escalation linkage. */
  entity?: { type: string; id: string }
  /** Escalation reason detail (agent context, etc.). */
  escalationNote?: string
  /**
   * Email reputation stream for the envelope-From (transactional notify. vs marketing
   * mail.). Absent → 'marketing' (the gated path is the campaign path). SMS ignores it.
   */
  messageClass?: EmailStream
  /**
   * FINAL PROVIDER-BOUNDARY suppression re-check subject (master build instruction: "Final
   * Provider-Boundary Re-check"). When present, the dispatcher re-evaluates effective BUSINESS
   * suppression FRESH immediately before the irreversible provider call — so a message that
   * was gate-cleared while the recipient was eligible is still stopped if the client or their
   * agent became blocked in the interim (queue/retry/async gap). The send path supplies this
   * ONLY for business-suppression-eligible (non-transactional) sends; transactional/servicing
   * sends omit it and are never business-suppressed. Absent → no re-check (existing callers
   * unaffected).
   */
  suppressionSubject?: SuppressionSubject
  /**
   * FSOS-030: the comm_messages row id, echoed to the provider as a deterministic callback
   * correlation key (Twilio StatusCallback `?mid=`, Resend `X-FSOS-Message-Id`). It exists
   * BEFORE the irreversible provider call, so a status callback correlates even if it arrives
   * before the post-dispatch provider_id patch (or if provider_id is never captured). Absent →
   * providers fall back to provider_id correlation (existing behavior).
   */
  correlationId?: string
}

export interface DispatchResult {
  sent: boolean
  gate: GateResult
  escalated: boolean
  providerId?: string
  error?: string
  /**
   * The EXACT body transmitted (SMS carries the appended opt-out footer). Returned so
   * the caller can persist what was actually sent — the stored/audited body must include
   * the compliance footer that went out (§13.9). Present only when sent.
   */
  sentBody?: string
}

// Side-effects the dispatcher performs. Defaults write to Supabase / send via the
// messaging senders; tests inject spies to assert block-and-escalate deterministically.
export interface DispatchDeps {
  recordComplianceEvent(req: DispatchRequest, gate: GateResult): Promise<void>
  createEscalation(req: DispatchRequest, gate: GateResult): Promise<void>
  writeAudit(entry: AuditEntry): Promise<void>
  /**
   * Final-boundary suppression re-check. Re-resolves effective BUSINESS suppression from the
   * DB immediately before send. Default → resolveEffectiveSuppression (suppression.ts), which
   * fails CLOSED (suppressed) on any lookup error. Injected in tests.
   */
  verifyNotSuppressed(subject: SuppressionSubject): Promise<SuppressionDecision>
  send(
    channel: 'sms' | 'email',
    to: string,
    body: string,
    subject?: string,
    bodyText?: string,
    messageClass?: EmailStream,
    correlationId?: string,
  ): Promise<SendResult>
}

// Real deps. Heavy modules are imported lazily (relative) so this file is
// importable without eagerly loading Supabase/Resend (keeps the pure path testable).
export const defaultDeps: DispatchDeps = {
  async recordComplianceEvent(req, gate) {
    try {
      const { getDb } = await import('../supabase/client')
      await getDb()
        .from('compliance_events')
        .insert({
          kind: 'comms_blocked',
          actor: req.actor,
          channel: req.channel,
          recipient: req.to,
          entity_type: req.entity?.type ?? null,
          entity_id: req.entity?.id ?? null,
          blocked_step: gate.blockedStep ?? null,
          reason: gate.reason ?? null,
        })
    } catch {
      /* best-effort; the audit write below is the durable record */
    }
  },
  async createEscalation(req, gate) {
    // Blocked sends escalate to the human FSA (the AI escalations queue). Securities
    // items are never sendable from FSOS and route to FFS from that queue.
    try {
      const { getDb } = await import('../supabase/client')
      await getDb()
        .from('agent_actions')
        .insert({
          kind: 'escalation',
          actor: req.actor,
          outcome: 'escalated',
          target_type: req.entity?.type ?? null,
          target_id: req.entity?.id ?? null,
          reason: gate.reason ?? null,
          blocked_step: gate.blockedStep ?? null,
          note: req.escalationNote ?? null,
          drafted_content: req.body,
        })
    } catch {
      /* best-effort */
    }
  },
  async writeAudit(entry) {
    const { writeAudit } = await import('../audit/log')
    await writeAudit(entry)
  },
  async verifyNotSuppressed(subject) {
    // Lazy import keeps this file loadable without eagerly pulling the DB reader (the pure
    // gate path stays testable). resolveEffectiveSuppression fails closed on any error.
    const { resolveEffectiveSuppression } = await import('./suppression')
    return resolveEffectiveSuppression(subject)
  },
  async send(channel, to, body, subject, bodyText, messageClass, correlationId) {
    const { sendSms, sendEmail } = await import('../messaging')
    // FSOS-030: echo the message id so the provider returns it on every status callback.
    if (channel === 'sms') return sendSms(to, body, correlationId)
    // Email deliverability: route replies to the monitored inbox and attach the RFC 8058
    // List-Unsubscribe one-click headers (Gmail/Yahoo bulk-sender requirement). The
    // per-recipient in-body unsubscribe link is already substituted via {{unsubscribe_url}}.
    const { emailListUnsubscribeHeaders, replyToAddress } = await import('./unsubscribe')
    // Reputation isolation: resolve the envelope From for this stream (marketing mail. vs
    // transactional notify.). Falls back to RESEND_FROM_EMAIL until the subdomains are
    // configured, so this is behavior-preserving. A per-stream reply-to override wins;
    // otherwise the existing monitored reply-to inbox is kept.
    const { resolveSender } = await import('./senders')
    const sender = resolveSender(messageClass ?? 'marketing')
    return sendEmail(to, subject ?? '', body, bodyText, {
      from: sender.from || undefined,
      replyTo: sender.replyTo || replyToAddress(),
      headers: {
        ...emailListUnsubscribeHeaders(to),
        // FSOS-030: deterministic callback correlation key echoed on Resend email.* events.
        ...(correlationId ? { 'X-FSOS-Message-Id': correlationId } : {}),
      },
    })
  },
}

/** Dispatch one message through the gate. Blocked → logged + escalated, never sent. */
export async function dispatch(req: DispatchRequest, deps: DispatchDeps = defaultDeps): Promise<DispatchResult> {
  const gate = evaluateGate({ draft: req.body, channel: req.channel, ...req.gate })

  if (!gate.allowed) {
    // A non-escalating block (business_hours) is an operational DEFERRAL, not a
    // compliance violation: audit it and hold the send, but do NOT record a
    // compliance event or create a human-FSA escalation. Every other block escalates.
    if (gate.escalate) {
      await deps.recordComplianceEvent(req, gate)
      await deps.createEscalation(req, gate)
    }
    await deps.writeAudit({
      actor: req.actor,
      // Securities blocks are firewall events; BUSINESS suppression is comms.suppressed;
      // other deferrals are comms.deferred; all remaining blocks are comms.blocked.
      action: gate.blockedStep === 'is_security'
        ? 'firewall.blocked'
        : gate.blockedStep === 'suppression'
          ? 'comms.suppressed'
          : gate.escalate
            ? 'comms.blocked'
            : 'comms.deferred',
      entity: req.entity?.type ?? 'message',
      entityId: req.entity?.id ?? null,
      diff: { channel: req.channel, to: req.to, blockedStep: gate.blockedStep, reason: gate.reason },
    })
    return { sent: false, gate, escalated: gate.escalate }
  }

  // FINAL PROVIDER-BOUNDARY RE-CHECK (mandatory). The gate above ran on context the caller
  // computed; between then and now the client or their agent may have been blocked. Re-resolve
  // effective BUSINESS suppression FRESH here — the last point before the irreversible provider
  // call — so a queued/retried/async send that was eligible when built is still WITHHELD if
  // suppression flipped. Fail-closed: verifyNotSuppressed returns `suppressed` on any lookup
  // error, so an undetermined state never sends. Runs ONLY when the send path marked this send
  // business-suppression-eligible (non-transactional) by supplying a subject.
  if (req.suppressionSubject) {
    const decision = await deps.verifyNotSuppressed(req.suppressionSubject)
    if (decision.suppressed) {
      const boundaryGate: GateResult = {
        allowed: false,
        blockedStep: 'suppression',
        reason: decision.reason ?? 'Recipient is suppressed from applicable outreach (boundary re-check).',
        escalate: false,
      }
      await deps.writeAudit({
        actor: req.actor,
        action: 'comms.suppressed',
        entity: req.entity?.type ?? 'message',
        entityId: req.entity?.id ?? null,
        diff: {
          channel: req.channel,
          to: req.to,
          blockedStep: 'suppression',
          reason: boundaryGate.reason,
          layer: decision.layer,
          resolved: decision.resolved,
          boundary: true,
        },
      })
      return { sent: false, gate: boundaryGate, escalated: false }
    }
  }

  // Passed the gate + boundary re-check → send. SMS carries the carrier-required opt-out footer.
  const body = req.channel === 'sms' ? `${req.body}\n\n${SMS_OPT_OUT_FOOTER}` : req.body
  // Email multipart: pass the stored plaintext part when present (SMS is single-part).
  const result = await deps.send(
    req.channel,
    req.to,
    body,
    req.subject,
    req.channel === 'email' ? req.bodyText : undefined,
    req.messageClass,
    req.correlationId,
  )

  await deps.writeAudit({
    actor: req.actor,
    action: 'comms.sent',
    entity: req.entity?.type ?? 'message',
    entityId: req.entity?.id ?? null,
    diff: { channel: req.channel, to: req.to, ok: result.ok, providerId: result.id, error: result.error },
  })

  return { sent: result.ok, gate, escalated: false, providerId: result.id, error: result.error, sentBody: result.ok ? body : undefined }
}
