// src/lib/district-nurture/jobs.ts
// Retry/dead-letter sweep for the District Agent FS Nurture Campaign (observability parity with
// the other engines). Re-queues message executions still 'scheduled' past their retry time and
// moves ones past the retry ceiling to 'dead_letter'. The backoff/ceiling decision is the SHARED
// pure retryDecision (life-campaign/retry.ts). Fails SOFT if migration 114 (retry columns +
// 'dead_letter' status) has not been applied yet, so code/migration can deploy in either order.
import { getDb } from '@/lib/supabase/client'
import { resolveOrphanExecution, type OrphanRow } from '@/lib/ops/orphan-executions'
import { retryDecision } from '@/lib/life-campaign/retry'

export interface RetrySweepResult {
  ok: boolean
  retried: number
  deadLettered: number
  note: string
}

export async function runRetrySweep(maxAttempts = 5): Promise<RetrySweepResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  try {
    const { data: stuck, error } = await db
      .from('district_nurture_executions')
      .select('id, attempts, enrollment_id, touch_no, kind')
      .eq('status', 'scheduled')
      .not('idempotency_key', 'is', null)
      .lte('next_retry_at', nowISO)
      .limit(500)

    if (error) {
      return { ok: false, retried: 0, deadLettered: 0, note: `district-nurture-retry: could not read the retry queue (${error.message})` }
    }

    let retried = 0
    let deadLettered = 0
    let reconciled = 0
    let released = 0
    for (const x of stuck ?? []) {
      // Orphaned claim: the message of record decides — reconcile a send that went out, or (switch
      // ON) release a never-dispatched claim for the tick to re-attempt. Else the backoff below.
      const orphan = await resolveOrphanExecution(db, 'district_nurture_executions', 'district_nurture_enrollment', x as unknown as OrphanRow)
      if (orphan === 'reconciled_sent') { reconciled++; continue }
      if (orphan === 'released') { released++; continue }
      const decision = retryDecision((x.attempts as number) ?? 0, maxAttempts)
      if (decision.action === 'dead_letter') {
        await db
          .from('district_nurture_executions')
          .update({ status: 'dead_letter', attempts: decision.attempts, detail: { reason: 'retry_exhausted' } })
          .eq('id', x.id)
        deadLettered++
      } else {
        await db
          .from('district_nurture_executions')
          .update({ attempts: decision.attempts, next_retry_at: new Date(Date.now() + (decision.backoffMinutes ?? 0) * 60000).toISOString() })
          .eq('id', x.id)
        retried++
      }
    }
    return { ok: true, retried, deadLettered, note: `district-nurture-retry: ${retried} re-queued, ${deadLettered} dead-lettered, ${reconciled} reconciled as sent, ${released} released for re-dispatch` }
  } catch (e) {
    return { ok: false, retried: 0, deadLettered: 0, note: `district-nurture-retry: failed (${e instanceof Error ? e.message : 'error'})` }
  }
}
