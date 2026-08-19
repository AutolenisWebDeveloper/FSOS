// src/lib/services/eventDeletion.ts
// Permanent deletion of the two event-stream rows the operator can explicitly remove from the
// system: a compliance event (compliance_events) and an AI escalation (agent_actions,
// kind='escalation'). These back the Executive → Alerts feed, the AI Escalations queue, and its
// "Recent compliance events" panel.
//
// SEMANTICS — this is a REAL, permanent hard delete (the row is gone and does not return on
// refresh), distinct from resolve/dismiss/archive (which only set agent_actions.outcome). It is
// deliberately owner-gated at the route (fsa / super_admin) because these rows are the securities-
// firewall / comms-gate audit stream.
//
// SAFEGUARD — the destructive action is itself recorded in the append-only, INSERT-only audit_log
// (mig 010 / locked down by mig 077) as an `entity.deleted` row capturing who/when + the deleted
// row's non-sensitive context (kind/reason). So even though the event row is removed, an immutable
// trace of the deletion survives. (CLAUDE.md §6: important operations use the audit mechanism.)
//
// ORPHANS — neither row is referenced by any other table:
//   • compliance_events has NO foreign keys (entity_id is an untyped soft pointer) and nothing
//     references compliance_events.id.
//   • agent_actions.id is referenced by nothing; its only FK is inbound run_id → agent_runs
//     (ON DELETE CASCADE), so deleting one escalation strands no children.
// Authorization is enforced at the route; this service assumes an already-authorized actor.

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'

export type DeleteResult =
  | { ok: true; id: string }
  | { ok: false; kind: 'not_found' | 'error'; message: string }

/** Permanently delete one compliance_events row (Executive Alerts / Recent Compliance Events). */
export async function deleteComplianceEvent(actor: string, id: string): Promise<DeleteResult> {
  const db = getDb()
  // Read first so a missing row is a clean 404 and the audit trail captures what was removed.
  const { data: row, error: readErr } = await db
    .from('compliance_events')
    .select('id, kind, reason, entity_type, blocked_step, created_at')
    .eq('id', id)
    .maybeSingle()
  if (readErr) return { ok: false, kind: 'error', message: readErr.message }
  if (!row) return { ok: false, kind: 'not_found', message: 'Alert not found.' }

  const { data: del, error } = await db.from('compliance_events').delete().eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!del) return { ok: false, kind: 'not_found', message: 'Alert not found.' }

  await writeAudit({
    actor,
    action: 'entity.deleted',
    entity: 'compliance_event',
    entityId: id,
    diff: {
      permanent: true,
      kind: (row as { kind?: string }).kind ?? null,
      reason: (row as { reason?: string | null }).reason ?? null,
      entity_type: (row as { entity_type?: string | null }).entity_type ?? null,
      blocked_step: (row as { blocked_step?: string | null }).blocked_step ?? null,
      created_at: (row as { created_at?: string }).created_at ?? null,
    },
  })
  return { ok: true, id }
}

/** Permanently delete one AI escalation (agent_actions where kind='escalation'). */
export async function deleteEscalation(actor: string, id: string): Promise<DeleteResult> {
  const db = getDb()
  const { data: row, error: readErr } = await db
    .from('agent_actions')
    .select('id, kind, outcome, target_type, target_id, reason, blocked_step, created_at')
    .eq('id', id)
    .eq('kind', 'escalation')
    .maybeSingle()
  if (readErr) return { ok: false, kind: 'error', message: readErr.message }
  if (!row) return { ok: false, kind: 'not_found', message: 'Escalation not found.' }

  const { data: del, error } = await db
    .from('agent_actions')
    .delete()
    .eq('id', id)
    .eq('kind', 'escalation')
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!del) return { ok: false, kind: 'not_found', message: 'Escalation not found.' }

  await writeAudit({
    actor,
    action: 'entity.deleted',
    entity: 'agent_action',
    entityId: id,
    diff: {
      permanent: true,
      kind: 'escalation',
      outcome: (row as { outcome?: string | null }).outcome ?? null,
      target_type: (row as { target_type?: string | null }).target_type ?? null,
      target_id: (row as { target_id?: string | null }).target_id ?? null,
      reason: (row as { reason?: string | null }).reason ?? null,
    },
  })
  return { ok: true, id }
}
