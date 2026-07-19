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
 * Run `fn` at most once per `dedupeKey`. Backed by job_runs (unique dedupe_key).
 * A second invocation with the same key short-circuits with { skipped: true } —
 * this is what prevents double-sends / double-writes on cron re-fire or retry.
 */
export async function runIdempotent<T>(
  dedupeKey: string,
  job: string,
  fn: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  const db = getDb()
  const { error: claimError } = await db
    .from('job_runs')
    .insert({ dedupe_key: dedupeKey, job, status: 'running' })

  // Unique-violation → already claimed by a prior run → skip.
  if (claimError) {
    return { skipped: true }
  }

  try {
    const result = await fn()
    await db
      .from('job_runs')
      .update({ status: 'completed', finished_at: new Date().toISOString() })
      .eq('dedupe_key', dedupeKey)
    return { skipped: false, result }
  } catch (err) {
    await db
      .from('job_runs')
      .update({
        status: 'errored',
        finished_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      })
      .eq('dedupe_key', dedupeKey)
    throw err
  }
}
