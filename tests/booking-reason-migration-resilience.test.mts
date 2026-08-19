// Public booking — deploy-order resilience for the `appointments.reason` column (migration 121).
//
// FSOS ships code and DB migrations on independent paths (the build is `next build`, no migrate
// step — ADR-039). A deploy carrying the reason-writing booking code can therefore reach prod
// BEFORE migration 121 adds `appointments.reason`. Before the fix, that made every native
// booking INSERT fail and the booker saw the generic "We couldn't complete your booking." error.
//
// These prove the classifiers book.ts relies on: a missing-reason-column error is recognized
// (so the service retries WITHOUT reason instead of 500-ing), a slot collision — via EITHER the
// unique OR the exclusion guard — is recognized as "just taken", and neither classifier ever
// masks an unrelated failure. Plus a source-scan that the service actually wires them in.
// Run: npx tsx tests/booking-reason-migration-resilience.test.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isMissingReasonColumnError,
  isSlotCollision,
  UNIQUE_VIOLATION,
  EXCLUSION_VIOLATION,
} from '../src/lib/booking/insert-errors'

let passed = 0
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name) }

console.log('Booking — reason-column migration-lag resilience')

// ── isMissingReasonColumnError ──────────────────────────────────────────────
t('PostgREST schema-cache miss (PGRST204) on `reason` is recognized', () => {
  assert.equal(
    isMissingReasonColumnError({
      code: 'PGRST204',
      message: "Could not find the 'reason' column of 'appointments' in the schema cache",
    }),
    true,
  )
})

t('Postgres undefined_column (42703) on `reason` is recognized', () => {
  assert.equal(
    isMissingReasonColumnError({
      code: '42703',
      message: 'column "reason" of relation "appointments" does not exist',
    }),
    true,
  )
})

t('a missing column that is NOT `reason` is NOT masked (stays a real failure)', () => {
  assert.equal(
    isMissingReasonColumnError({
      code: '42703',
      message: 'column "booking_token" of relation "appointments" does not exist',
    }),
    false,
  )
})

t('a slot collision is NOT mistaken for a missing column', () => {
  assert.equal(isMissingReasonColumnError({ code: UNIQUE_VIOLATION, message: 'duplicate key value' }), false)
})

t('null / undefined / empty errors are safe', () => {
  assert.equal(isMissingReasonColumnError(null), false)
  assert.equal(isMissingReasonColumnError(undefined), false)
  assert.equal(isMissingReasonColumnError({}), false)
})

// ── isSlotCollision ─────────────────────────────────────────────────────────
t('a unique_violation (identical start) is a collision', () => {
  assert.equal(isSlotCollision({ code: UNIQUE_VIOLATION }), true)
})

t('an exclusion_violation (overlapping range) is ALSO a collision', () => {
  assert.equal(isSlotCollision({ code: EXCLUSION_VIOLATION }), true)
})

t('an unrelated DB error is NOT a collision (must not read as "just taken")', () => {
  assert.equal(isSlotCollision({ code: '23502', message: 'null value in column violates not-null' }), false)
  assert.equal(isSlotCollision(null), false)
})

// ── wiring: the service uses the resilient path ─────────────────────────────
t('book.ts retries the insert without reason on a missing-reason-column error', () => {
  const book = readFileSync('src/lib/booking/book.ts', 'utf8')
  assert.match(book, /isMissingReasonColumnError/)
  assert.match(book, /insertAppointment\(baseRow\)/) // retry omits `reason`
  assert.match(book, /isSlotCollision/) // both race guards map to "just taken"
})

console.log(`\nAll ${passed} assertions passed.`)
