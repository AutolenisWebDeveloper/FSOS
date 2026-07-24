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
import { TRAIGA_SMS_FOOTER } from '../compliance'
import type { AuditEntry } from '../audit/log'
import type { SendResult } from '../messaging'

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
}

export interface DispatchResult {
  sent: boolean
  gate: GateResult
  escalated: boolean
  providerId?: string
  error?: string
}

// Side-effects the dispatcher performs. Defaults write to Supabase / send via the
// messaging senders; tests inject spies to assert block-and-escalate deterministically.
export interface DispatchDeps {
  recordComplianceEvent(req: DispatchRequest, gate: GateResult): Promise<void>
  createEscalation(req: DispatchRequest, gate: GateResult): Promise<void>
  writeAudit(entry: AuditEntry): Promise<void>
  send(channel: 'sms' | 'email', to: string, body: string, subject?: string, bodyText?: string): Promise<SendResult>
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
  async send(channel, to, body, subject, bodyText) {
    const { sendSms, sendEmail } = await import('../messaging')
    return channel === 'sms' ? sendSms(to, body) : sendEmail(to, subject ?? '', body, bodyText)
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
      // Securities blocks are firewall events; deferrals are comms.deferred; all other
      // blocks are comms.blocked.
      action: gate.blockedStep === 'is_security'
        ? 'firewall.blocked'
        : gate.escalate
          ? 'comms.blocked'
          : 'comms.deferred',
      entity: req.entity?.type ?? 'message',
      entityId: req.entity?.id ?? null,
      diff: { channel: req.channel, to: req.to, blockedStep: gate.blockedStep, reason: gate.reason },
    })
    return { sent: false, gate, escalated: gate.escalate }
  }

  // Passed the gate → send. SMS carries the required AI-disclosure/opt-out footer.
  const body = req.channel === 'sms' ? `${req.body}\n\n${TRAIGA_SMS_FOOTER}` : req.body
  // Email multipart: pass the stored plaintext part when present (SMS is single-part).
  const result = await deps.send(req.channel, req.to, body, req.subject, req.channel === 'email' ? req.bodyText : undefined)

  await deps.writeAudit({
    actor: req.actor,
    action: 'comms.sent',
    entity: req.entity?.type ?? 'message',
    entityId: req.entity?.id ?? null,
    diff: { channel: req.channel, to: req.to, ok: result.ok, providerId: result.id, error: result.error },
  })

  return { sent: result.ok, gate, escalated: false, providerId: result.id, error: result.error }
}
