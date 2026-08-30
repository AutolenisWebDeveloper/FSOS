// src/lib/comms/escalation.ts
// The block-and-escalate side-effects, extracted so the DISPATCH CHOKEPOINT (messaging.ts)
// can escalate without importing the dispatcher — which imports messaging, and would
// otherwise form a cycle.
//
// WHY THIS IS ITS OWN MODULE. "A blocked send is ALWAYS escalated, never silently dropped"
// is a stated WF invariant. When enforcement moved to the provider boundary, the escalation
// had to move with it: a boundary that can block but not escalate would satisfy the letter
// of the gate and quietly break the invariant, turning every block into a bare `{ok:false}`
// the caller may ignore. These writers are what make that impossible.
//
// Every write here is BEST-EFFORT and never throws into the caller: the send has already
// been withheld by the time these run, and an audit-store outage must not convert a
// correctly-blocked send into an exception that a caller might treat as retryable. The
// console.error is the last-resort durable signal.
//
// Heavy modules are imported LAZILY (dynamic import) so this file stays loadable inside the
// runtime-tsc test harness without eagerly pulling Supabase — the same technique
// dispatcher.ts uses to keep the pure path testable offline.

import type { GateStep } from './gate'
import type { AuditAction } from '../audit/log'

export interface EscalationContext {
  channel: 'sms' | 'email'
  to: string
  actor: string
  body: string
  entity?: { type: string; id: string } | undefined
  /** Free-text detail (agent + run linkage, path name). */
  note?: string | undefined
  /** The pre-inserted comm_messages row, when the caller created one. */
  messageId?: string | undefined
}

export interface BlockOutcome {
  blockedStep: GateStep | string
  reason: string
  /**
   * Whether this block is a COMPLIANCE event that must reach the human FSA, or an
   * operational deferral. Deferrals (business hours, a configured send window, frequency
   * caps, an A2P hold) are audited but do NOT raise a compliance event or an escalation —
   * flooding the FSA queue with "held until 9am" would bury the real blocks.
   */
  escalate: boolean
}

/** Record the compliance event for an escalating block. Best-effort. */
async function recordComplianceEvent(ctx: EscalationContext, outcome: BlockOutcome): Promise<void> {
  try {
    const { getDb } = await import('../supabase/client')
    await getDb().from('compliance_events').insert({
      kind: 'comms_blocked',
      actor: ctx.actor,
      channel: ctx.channel,
      recipient: ctx.to,
      entity_type: ctx.entity?.type ?? null,
      entity_id: ctx.entity?.id ?? null,
      blocked_step: outcome.blockedStep,
      reason: outcome.reason,
    })
  } catch {
    /* best-effort; the audit write is the durable record */
  }
}

/** Raise the blocked send to the human-FSA queue. Best-effort. */
async function createEscalation(ctx: EscalationContext, outcome: BlockOutcome): Promise<void> {
  try {
    const { getDb } = await import('../supabase/client')
    await getDb().from('agent_actions').insert({
      kind: 'escalation',
      actor: ctx.actor,
      outcome: 'escalated',
      target_type: ctx.entity?.type ?? null,
      target_id: ctx.entity?.id ?? null,
      reason: outcome.reason,
      blocked_step: outcome.blockedStep,
      note: ctx.note ?? null,
      drafted_content: ctx.body,
    })
  } catch {
    /* best-effort */
  }
}

/**
 * The audit action for a block, chosen by what actually stopped it. Securities blocks are
 * firewall events; business suppression is its own action; non-escalating holds are
 * `comms.deferred`; everything else is `comms.blocked`. Callers must not invent their own.
 */
export function auditActionFor(outcome: BlockOutcome): AuditAction {
  if (outcome.blockedStep === 'is_security') return 'firewall.blocked'
  if (outcome.blockedStep === 'suppression') return 'comms.suppressed'
  return outcome.escalate ? 'comms.blocked' : 'comms.deferred'
}

/**
 * Handle one blocked send completely: audit it, and — when it is a compliance block rather
 * than an operational deferral — record the compliance event and raise the FSA escalation.
 *
 * Call this on EVERY withheld send at the chokepoint. It is the single reason a block at
 * the provider boundary cannot become a silent drop.
 */
export async function escalateBlockedSend(
  ctx: EscalationContext,
  outcome: BlockOutcome,
  extraDiff: Record<string, unknown> = {},
): Promise<void> {
  if (outcome.escalate) {
    await recordComplianceEvent(ctx, outcome)
    await createEscalation(ctx, outcome)
  }
  try {
    const { writeAudit } = await import('../audit/log')
    await writeAudit({
      actor: ctx.actor,
      action: auditActionFor(outcome),
      entity: ctx.entity?.type ?? 'message',
      entityId: ctx.entity?.id ?? null,
      diff: {
        channel: ctx.channel,
        to: ctx.to,
        blockedStep: outcome.blockedStep,
        reason: outcome.reason,
        messageId: ctx.messageId ?? null,
        ...extraDiff,
      },
    })
  } catch (err) {
    // If even the audit store is unavailable, leave a durable process-level trace. A
    // blocked send must never vanish without any record anywhere.
    // eslint-disable-next-line no-console
    console.error('[comms] blocked-send audit failed:', outcome.blockedStep, outcome.reason, err)
  }
}

/** Audit a send that actually reached the provider. Best-effort, never throws. */
export async function auditSentMessage(
  ctx: EscalationContext,
  result: { ok: boolean; id?: string; error?: string },
): Promise<void> {
  try {
    const { writeAudit } = await import('../audit/log')
    await writeAudit({
      actor: ctx.actor,
      action: 'comms.sent',
      entity: ctx.entity?.type ?? 'message',
      entityId: ctx.entity?.id ?? null,
      diff: { channel: ctx.channel, to: ctx.to, ok: result.ok, providerId: result.id, error: result.error },
    })
  } catch {
    /* best-effort */
  }
}
