// src/lib/pipeline-winback/jobs.ts
// Background sweeps for the Pipeline Win-Back Campaign that don't belong in the cron handler (so
// they stay unit-testable). Currently the retry/dead-letter sweep (§20 observability parity, C1/D9):
// it re-queues message executions still 'scheduled' past their retry time and moves ones past the
// retry ceiling to 'dead_letter' for operator attention. The backoff/ceiling decision is the SHARED
// pure retryDecision (life-campaign/retry.ts) — Win-Back escalates identically to the other engines
// (ADR-031 shared campaign-engine primitives).
//
// Pre-migration tolerance: the retry columns and the 'dead_letter' status arrive in migration 088.
// If this job runs before that migration is applied, the first query returns a schema error — we
// FAIL SOFT (no-op with a note) rather than crash the cron, so code and migration can deploy in
// either order (§16 graceful degradation).
import { getDb } from '@/lib/supabase/client'
import { retryDecision } from '@/lib/life-campaign/retry'

export interface RetrySweepResult {
  ok: boolean
  retried: number
  deadLettered: number
  note: string
}

/** Retry/dead-letter sweep (§20). Bounded to 500 rows per run. */
export async function runRetrySweep(maxAttempts = 5): Promise<RetrySweepResult> {
  const db = getDb()
  const nowISO = new Date().toISOString()

  try {
    const { data: stuck, error } = await db
      .from('pipeline_winback_executions')
      .select('id, attempts')
      .eq('status', 'scheduled')
      .not('idempotency_key', 'is', null)
      .lte('next_retry_at', nowISO)
      .limit(500)

    if (error) {
      return { ok: true, retried: 0, deadLettered: 0, note: `pipeline-winback-retry: skipped — schema pending (${error.message})` }
    }

    let retried = 0
    let deadLettered = 0
    for (const x of stuck ?? []) {
      const decision = retryDecision((x.attempts as number) ?? 0, maxAttempts)
      if (decision.action === 'dead_letter') {
        await db
          .from('pipeline_winback_executions')
          .update({ status: 'dead_letter', attempts: decision.attempts, detail: { reason: 'retry_exhausted' } })
          .eq('id', x.id)
        deadLettered++
      } else {
        await db
          .from('pipeline_winback_executions')
          .update({ attempts: decision.attempts, next_retry_at: new Date(Date.now() + (decision.backoffMinutes ?? 0) * 60000).toISOString() })
          .eq('id', x.id)
        retried++
      }
    }
    return { ok: true, retried, deadLettered, note: `pipeline-winback-retry: ${retried} re-queued, ${deadLettered} dead-lettered` }
  } catch (e) {
    return { ok: true, retried: 0, deadLettered: 0, note: `pipeline-winback-retry: skipped (${e instanceof Error ? e.message : 'error'})` }
  }
}
