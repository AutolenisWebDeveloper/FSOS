// src/lib/booking/insert-errors.ts
// Pure classifiers for the appointment-INSERT errors the public booking service must handle
// without returning an opaque 500 to the booker. Dependency-free (no DB, no clock) so they
// are unit-provable offline.
//
// WHY THIS EXISTS (deploy-order resilience): FSOS ships application code and database
// migrations on INDEPENDENT paths — the Vercel build is `next build` with no migrate step,
// and migrations are applied out of band (ADR-039: there is a documented history of a repo
// migration being live in code but missing from prod for an unknown period). So a deploy that
// carries the `reason`-writing booking code can reach production BEFORE migration 121 adds the
// `appointments.reason` column. Without the guard below, every native booking INSERT then
// fails and the booker sees "We couldn't complete your booking." — a total booking outage from
// nothing more than a deploy/migration ordering gap. `reason` is optional green-zone metadata,
// so a missing column must degrade gracefully, never take down scheduling.

export interface DbInsertError {
  code?: string | null
  message?: string | null
}

// A slot collision surfaces as one of two DB errors depending on which guard fires:
//   • 23505 unique_violation      — uq_appointments_host_slot / _nullhost_slot (identical start)
//   • 23P01 exclusion_violation   — excl_appointments_host_overlap / _nullhost_overlap (range &&)
// Both mean the same thing to a booker: the time was just taken. (mig 069 / 091 / 119.)
export const UNIQUE_VIOLATION = '23505'
export const EXCLUSION_VIOLATION = '23P01'

/** True iff the INSERT failed because the slot was concurrently taken (either race guard). */
export function isSlotCollision(err: DbInsertError | null | undefined): boolean {
  const code = err?.code ?? ''
  return code === UNIQUE_VIOLATION || code === EXCLUSION_VIOLATION
}

// "Column not found" can arrive two ways: PostgREST rejects an unknown payload key against its
// schema cache with PGRST204, while Postgres itself raises 42703 (undefined_column) when the
// column is genuinely absent. Either can appear depending on whether PostgREST's cache is stale
// or freshly reloaded, so we match both.
const MISSING_COLUMN_CODES = new Set(['PGRST204', '42703'])

/**
 * True iff `err` is specifically "the `reason` column does not exist" — the migration-lag
 * signature. Deliberately scoped to the `reason` column by matching the column name in the
 * message, so that a DIFFERENT missing column (which would be a real bug, not a known
 * deploy-order gap) is never silently masked by the retry.
 */
export function isMissingReasonColumnError(err: DbInsertError | null | undefined): boolean {
  if (!err) return false
  if (!MISSING_COLUMN_CODES.has(err.code ?? '')) return false
  return (err.message ?? '').toLowerCase().includes('reason')
}
