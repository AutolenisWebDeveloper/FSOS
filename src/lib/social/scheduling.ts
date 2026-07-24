// Social scheduling — pure logic (ADR-026, Slice 3). No I/O; unit-testable.
//
// Covers conflict detection (two posts to the same channel too close together),
// exponential backoff for retries, dead-letter cutoff, dueness, and the schedule
// status-transition guards. The DB service (schedule.ts) and the publish job
// (publisher.ts) build on these.

export type SocialScheduleStatus = 'pending' | 'publishing' | 'published' | 'failed' | 'cancelled'

// Config defaults — verify against operating policy (§4.3 assumptions). Not
// Farmers-published figures; safe, conservative scheduling defaults.
export const MIN_SCHEDULE_GAP_MINUTES = 30
export const MAX_PUBLISH_ATTEMPTS = 5
export const BACKOFF_BASE_MS = 60_000 // 1 min
export const BACKOFF_FACTOR = 2
export const BACKOFF_MAX_MS = 3_600_000 // 1 hour cap

// True if `candidateMs` lands within `gapMinutes` of any existing scheduled time
// for the same channel. `existingMs` should already exclude the entry being moved.
export function hasScheduleConflict(
  existingMs: number[],
  candidateMs: number,
  gapMinutes: number = MIN_SCHEDULE_GAP_MINUTES,
): boolean {
  const gap = gapMinutes * 60_000
  return existingMs.some((t) => Math.abs(t - candidateMs) < gap)
}

// Exponential backoff for attempt N (1-indexed): base * factor^(N-1), capped.
export function computeBackoffMs(attempt: number): number {
  if (attempt <= 1) return BACKOFF_BASE_MS
  const raw = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, attempt - 1)
  return Math.min(raw, BACKOFF_MAX_MS)
}

// After a failed attempt: has the entry exhausted its retries (→ dead-letter)?
export function isDeadLettered(attempts: number): boolean {
  return attempts >= MAX_PUBLISH_ATTEMPTS
}

// A pending/failed entry is due to attempt when its scheduled time has passed AND
// any backoff window (next_attempt_at) has elapsed.
export function isDue(scheduledAtMs: number, nextAttemptAtMs: number | null, nowMs: number): boolean {
  if (scheduledAtMs > nowMs) return false
  if (nextAttemptAtMs !== null && nextAttemptAtMs > nowMs) return false
  return true
}

// Terminal states cannot be rescheduled/cancelled; only a pending (or dead-lettered
// failed, to retry) entry may be rescheduled; only pending/failed may be cancelled.
export function canReschedule(status: SocialScheduleStatus): boolean {
  return status === 'pending' || status === 'failed'
}

export function canCancel(status: SocialScheduleStatus): boolean {
  return status === 'pending' || status === 'failed'
}

// The pure decision after a publish attempt — the heart of idempotent retry.
//   • success            → published (terminal)
//   • not_configured     → HOLD (stay pending, no attempt counted) until the account
//                          is connected; a longer next_attempt_at throttles polling
//   • non-retryable error→ dead-letter (failed, terminal) — invalid content, auth
//   • retryable error    → retry with exponential backoff, until MAX_PUBLISH_ATTEMPTS
//                          then dead-letter
export type PublishDecisionKind = 'published' | 'hold' | 'retry' | 'dead_letter'

export interface PublishAttemptResult {
  ok: boolean
  error?: { code: string; retryable: boolean }
}

export interface PublishDecision {
  kind: PublishDecisionKind
  nextStatus: SocialScheduleStatus
  attemptsInc: 0 | 1
  nextAttemptAtMs: number | null
}

export function planAfterAttempt(result: PublishAttemptResult, attempts: number, nowMs: number): PublishDecision {
  if (result.ok) {
    return { kind: 'published', nextStatus: 'published', attemptsInc: 1, nextAttemptAtMs: null }
  }
  const err = result.error
  if (err?.code === 'not_configured') {
    // Hold — the account may be connected later. Do not consume a retry.
    return { kind: 'hold', nextStatus: 'pending', attemptsInc: 0, nextAttemptAtMs: nowMs + BACKOFF_MAX_MS }
  }
  if (!err?.retryable) {
    return { kind: 'dead_letter', nextStatus: 'failed', attemptsInc: 1, nextAttemptAtMs: null }
  }
  const newAttempts = attempts + 1
  if (isDeadLettered(newAttempts)) {
    return { kind: 'dead_letter', nextStatus: 'failed', attemptsInc: 1, nextAttemptAtMs: null }
  }
  return { kind: 'retry', nextStatus: 'pending', attemptsInc: 1, nextAttemptAtMs: nowMs + computeBackoffMs(newAttempts) }
}
