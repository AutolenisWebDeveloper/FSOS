// src/lib/jobs/runtime.ts
// Durable-job primitives shared by every cron handler + the agent runner:
// idempotency (dedupe key) and retry-with-backoff. Build-order §Foundation.7 and
// the cross-workflow invariant "every long-running job is idempotent, retries
// with backoff, and checks the kill switch."

import { getDb } from '@/lib/supabase/client'

export interface RetryOptions {
  retries?: number
  baseMs?: number
  factor?: number
}

/** Retry an async fn with exponential backoff. Rethrows the last error. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 200, factor = 2 } = opts
  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries) throw err
      const delay = baseMs * Math.pow(factor, attempt)
      attempt++
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

export interface IdempotentOutcome<T> {
  skipped: boolean
  result?: T
}

/**
 * A `running` job_runs claim older than this is presumed DEAD — the process that
 * held it was hard-killed (serverless timeout / OOM) before it could complete or
 * release the row. Such a claim is reclaimable so the work can actually run. Sized
 * comfortably above the longest legitimate single job (well under a cron window).
 */
export const JOB_LEASE_MS = 15 * 60 * 1000

/**
 * Run `fn` at most once *successfully* per `dedupeKey`. Backed by job_runs
 * (unique dedupe_key). A concurrent or already-completed invocation with the same
 * key short-circuits with { skipped: true } — this is what prevents double-sends /
 * double-writes on cron re-fire or retry.
 *
 * Failure semantics: if `fn` THROWS (an unexpected/infra error — note a compliance
 * BLOCK is a normal return, not a throw), the claim row is released so a legitimate
 * retry with the same key can re-run. Otherwise a transient error on the first
 * attempt would poison the key and every retry would return { skipped: true } — a
 * FALSE "already done" success for an operation that never actually completed
 * (§11.1/§16.3: an idempotent job must remain retryable after a transient failure).
 *
 * Dead-claim recovery: a hard KILL (serverless timeout / OOM) is not a throw, so it
 * cannot release the row — the claim would otherwise stay `running` forever and
 * every future retry would falsely skip. On a unique-violation we therefore reclaim
 * a `running` row whose lease (started_at) has expired (> JOB_LEASE_MS old) via an
 * atomic conditional update, and re-run. A still-fresh `running` row means a genuine
 * concurrent run, and a `completed` row means done — both correctly skip. (Reclaim is
 * at-least-once in the rare event two runners race the same expired lease — vastly
 * preferable to a permanently stalled job window.)
 */
export async function runIdempotent<T>(
  dedupeKey: string,
  job: string,
  fn: () => Promise<T>,
  opts: { leaseMs?: number } = {},
): Promise<IdempotentOutcome<T>> {
  const db = getDb()
  const { error: claimError } = await db
    .from('job_runs')
    .insert({ dedupe_key: dedupeKey, job, status: 'running' })

  // Unique-violation → a row already exists. Distinguish a dead (expired-lease)
  // `running` claim we can take over from a live concurrent run / completed row.
  if (claimError) {
    const staleBefore = new Date(Date.now() - (opts.leaseMs ?? JOB_LEASE_MS)).toISOString()
    const { data: reclaimed } = await db
      .from('job_runs')
      .update({ status: 'running', started_at: new Date().toISOString(), error: null, finished_at: null })
      .eq('dedupe_key', dedupeKey)
      .eq('status', 'running')
      .lt('started_at', staleBefore)
      .select('id')
    // Nothing reclaimed → the row is completed, or a fresh (live) running claim → skip.
    if (!reclaimed || reclaimed.length === 0) return { skipped: true }
    // else: we took over an expired lease → fall through and actually run the work.
  }

  try {
    const result = await fn()
    await db
      .from('job_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString() })
      .eq('dedupe_key', dedupeKey)
    return { skipped: false, result }
  } catch (err) {
    // Release the claim so a retry can re-run — never leave an errored row that would
    // make the next attempt a false idempotent skip. The error is rethrown for the
    // caller to log/handle (job_runs is a dedupe ledger, not the primary error audit).
    await db.from('job_runs').delete().eq('dedupe_key', dedupeKey).eq('status', 'running')
    throw err
  }
}
