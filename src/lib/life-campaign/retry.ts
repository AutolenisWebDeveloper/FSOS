// src/lib/life-campaign/retry.ts
// The Life Conversion retry/dead-letter DECISION, PURE (no DB/clock) — mirrors the reference
// Cross-Sell engine's backoff so the two campaigns escalate stuck executions identically. Kept
// pure so the escalation schedule is provable offline (tests/life-campaign-retry.test.mjs); jobs.ts
// applies it against the DB.

/** Exponential-ish backoff (minutes) between retry attempts: 5m → 30m → 2h → 24h, then held. */
export const RETRY_BACKOFF_MINUTES = [5, 30, 120, 1440] as const

export interface RetryDecision {
  action: 'retry' | 'dead_letter'
  /** The new attempt count to persist. */
  attempts: number
  /** Minutes until the next retry (null when dead-lettered). */
  backoffMinutes: number | null
}

/**
 * Decide what to do with a stuck execution given how many times it has already been attempted.
 * At or past `maxAttempts` it dead-letters (terminal, operator attention); otherwise it schedules
 * the next retry using the backoff table (clamped to its last entry).
 */
export function retryDecision(priorAttempts: number, maxAttempts = 5): RetryDecision {
  const attempts = priorAttempts + 1
  if (attempts >= maxAttempts) return { action: 'dead_letter', attempts, backoffMinutes: null }
  const backoffMinutes = RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)]
  return { action: 'retry', attempts, backoffMinutes }
}
