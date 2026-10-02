// src/lib/ops/orphan-executions.ts
// What the four campaign retry sweeps do with an ORPHANED message claim (audit D-07 / E-10 / H-11 /
// J-06): an execution row still 'scheduled' with its retry time passed, i.e. a tick that claimed a
// touch and died before recording the outcome. The sweeps used to bump `attempts` until the row
// dead-lettered — nothing ever re-sent it, and a touch that DID go out was dead-lettered anyway.
//
// The message of record answers what happened (send.ts pre-inserts it before dispatch, keyed by
// entity + sequence_step):
//   • a row with sent_at            → the touch went out: reconcile the execution to 'sent' (truth,
//                                     not a send);
//   • no row at all                 → the send never reached dispatch: RELEASE the claim so the next
//                                     tick re-claims the still-due touch and re-runs stop
//                                     conditions, eligibility and the gate — only when the
//                                     `engine_retry_redispatch` switch is ON (new sending; off by
//                                     default). `canary` cannot apply here: with no message row the
//                                     sweep has no recipient to compare to the allow-list.
//   • anything else (queued / blocked / unreadable) → unchanged; the existing backoff and
//                                     dead-letter path decides, and a human looks at it.

import { readSwitchMode } from './automation-switch'

type Db = { from: (table: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

export type OrphanVerdict = 'sent' | 'never_dispatched' | 'ambiguous'

/** PURE: classify an orphaned claim from its message of record. */
export function classifyOrphan(
  messages: ReadonlyArray<{ sent_at: string | null }> | null,
  readError: boolean,
): OrphanVerdict {
  if (readError || messages === null) return 'ambiguous'
  if (messages.length === 0) return 'never_dispatched'
  return messages.some((m) => !!m.sent_at) ? 'sent' : 'ambiguous'
}

export interface OrphanRow {
  id: string
  enrollment_id: string
  touch_no: number
  kind: string | null
}

/** Resolve one orphaned execution. Never throws; 'unchanged' leaves the caller's backoff to act. */
export async function resolveOrphanExecution(
  db: Db,
  executionsTable: string,
  entityType: string,
  x: OrphanRow,
): Promise<'reconciled_sent' | 'released' | 'unchanged'> {
  if (x.kind === 'advisor_outreach') return 'unchanged' // a task, not a message
  try {
    const { data, error } = await db
      .from('comm_messages')
      .select('id, sent_at')
      .eq('direction', 'outbound')
      .eq('entity_type', entityType)
      .eq('entity_id', x.enrollment_id)
      .eq('sequence_step', x.touch_no)
      .limit(5)
    const verdict = classifyOrphan((data as Array<{ id: string; sent_at: string | null }> | null) ?? null, !!error)
    if (verdict === 'sent') {
      const sent = (data as Array<{ id: string; sent_at: string | null }>).find((m) => !!m.sent_at)
      await db
        .from(executionsTable)
        .update({ status: 'sent', detail: { reason: 'reconciled_from_message_of_record', messageId: sent?.id ?? null }, executed_at: sent?.sent_at ?? new Date().toISOString() })
        .eq('id', x.id)
        .eq('status', 'scheduled')
      return 'reconciled_sent'
    }
    if (verdict === 'never_dispatched' && (await readSwitchMode('engine_retry_redispatch')) === 'on') {
      await db.from(executionsTable).delete().eq('id', x.id).eq('status', 'scheduled')
      return 'released'
    }
  } catch {
    /* unreadable → unchanged */
  }
  return 'unchanged'
}
