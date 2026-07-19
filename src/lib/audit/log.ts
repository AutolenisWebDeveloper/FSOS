// src/lib/audit/log.ts
// GUARDRAIL 4 support — the append-only audit writer (data-guardrails §7).
// Every business mutation, every send/block, every AI action and stage change
// writes here. The DB grants the app role INSERT-only on audit_log (migration
// 010), so this is tamper-evident by construction; this module is the single
// write path the app uses.

import { getDb } from '../supabase/client'

// Audit event taxonomy (data-api-map §4). Kept as a const union so callers can't
// invent an untracked action name.
export const AUDIT_ACTIONS = [
  'entity.created',
  'entity.updated',
  'entity.deleted',
  'entity.viewed',
  'stage.changed',
  'comms.sent',
  'comms.blocked',
  'comms.deferred',
  'consent.captured',
  'consent.revoked',
  'firewall.blocked',
  'ai.run',
  'ai.action',
  'ai.escalated',
  'approval.decided',
  'config.changed',
  'import.committed',
  'import.rolledback',
  'impersonation.started',
  'impersonation.ended',
  'incident.step',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export interface AuditEntry {
  /** Authenticated user id, an agent key ("agent:pipeline"), or "system". */
  actor: string
  action: AuditAction
  entity: string
  entityId?: string | null
  /** Field-level diff / structured context. Never store securities substantive data here. */
  diff?: Record<string, unknown> | null
}

/** Build the row shape (pure — used by tests and by writeAudit). */
export function buildAuditRow(entry: AuditEntry) {
  return {
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    diff: entry.diff ?? null,
  }
}

export interface AuditResult {
  ok: boolean
  error?: string
}

/**
 * Append one audit row. Best-effort: returns a result instead of throwing so a
 * mutation's own success isn't reversed by an audit hiccup — but a false result
 * should be surfaced/monitored (an un-audited mutation violates the DoD).
 */
export async function writeAudit(entry: AuditEntry): Promise<AuditResult> {
  try {
    const { error } = await getDb().from('audit_log').insert(buildAuditRow(entry))
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
