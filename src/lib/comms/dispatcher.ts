// src/lib/comms/dispatcher.ts
// GUARDRAIL 3 (execution) — the communications dispatcher. The single send path
// for every automated SMS/email. It runs the pure 7-step gate (gate.ts), and:
//   • on ALLOW  → sends via the existing messaging senders + audits comms.sent
//   • on BLOCK  → writes a compliance_event, creates a human-FSA escalation, and
//                 audits comms.blocked — NEVER sends, NEVER silently drops.
// There is deliberately no "force send" path (WF-5 invariant). The enforcement
// DECISION lives in gate.ts (pure, unit-tested); this module executes it.

import { evaluateGate, type GateInput, type GateResult } from './gate'
import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { sendEmail, sendSms, type SendResult } from '@/lib/messaging'
import { TRAIGA_SMS_FOOTER } from '@/lib/compliance'

export interface DispatchRequest {
  channel: 'sms' | 'email'
  to: string
  /** email only */
  subject?: string
  body: string
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

async function recordComplianceEvent(req: DispatchRequest, gate: GateResult): Promise<void> {
  try {
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
    /* compliance_events best-effort; audit below is the durable record */
  }
}

async function createEscalation(req: DispatchRequest, gate: GateResult): Promise<void> {
  // Blocked sends escalate to the human FSA (the AI escalations queue). Securities
  // items are never sendable from FSOS and route to FFS from that queue.
  try {
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
}

/** Dispatch one message through the gate. */
export async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
  const gate = evaluateGate({ draft: req.body, channel: req.channel, ...req.gate })

  if (!gate.allowed) {
    await recordComplianceEvent(req, gate)
    await createEscalation(req, gate)
    await writeAudit({
      actor: req.actor,
      action: gate.blockedStep === 'is_security' ? 'firewall.blocked' : 'comms.blocked',
      entity: req.entity?.type ?? 'message',
      entityId: req.entity?.id ?? null,
      diff: { channel: req.channel, to: req.to, blockedStep: gate.blockedStep, reason: gate.reason },
    })
    return { sent: false, gate, escalated: true }
  }

  // Passed the gate → send. SMS carries the required AI-disclosure/opt-out footer.
  let result: SendResult
  if (req.channel === 'sms') {
    result = await sendSms(req.to, `${req.body}\n\n${TRAIGA_SMS_FOOTER}`)
  } else {
    result = await sendEmail(req.to, req.subject ?? '', req.body)
  }

  await writeAudit({
    actor: req.actor,
    action: 'comms.sent',
    entity: req.entity?.type ?? 'message',
    entityId: req.entity?.id ?? null,
    diff: { channel: req.channel, to: req.to, ok: result.ok, providerId: result.id, error: result.error },
  })

  return { sent: result.ok, gate, escalated: false, providerId: result.id, error: result.error }
}
