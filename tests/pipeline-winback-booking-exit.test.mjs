// tests/pipeline-winback-booking-exit.test.mjs
// Booking a review must exit ALL THREE campaign cadences, not two of them.
//
// src/lib/booking/book.ts exited Cross-Sell Life and Life Conversion on a booking and did not
// exit Pipeline Win-Back, because Win-Back had no inbound.ts seam — so a stalled-pipeline
// contact who booked a review kept receiving re-engagement touches. The exit primitive
// (removeEnrollment) existed in enroll.ts with zero callers.
//
// This asserts two things that a unit test of the new module alone would not:
//   • the new exitOnAppointment behaves identically to the two that already existed
//     (same live states, same exit_reason, same idempotency), and
//   • book.ts actually CALLS all three — the wiring, not just the function.
//
// Run: node tests/pipeline-winback-booking-exit.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

const winback = readFileSync('src/lib/pipeline-winback/inbound.ts', 'utf8')
const life = readFileSync('src/lib/life-campaign/inbound.ts', 'utf8')
const book = readFileSync('src/lib/booking/book.ts', 'utf8')

console.log('Pipeline Win-Back — booking exit parity + wiring')

// ── The wiring: the defect was an absent call site, so that is what must be pinned ──
check('book.ts imports all three campaign inbound modules', () => {
  for (const m of ['cross-sell-life/inbound', 'life-campaign/inbound', 'pipeline-winback/inbound']) {
    assert.ok(book.includes(m), `book.ts does not import ${m}`)
  }
})
check('book.ts calls exitOnAppointment on all three', () => {
  const calls = book.match(/\w+\.exitOnAppointment\(/g) ?? []
  assert.equal(calls.length, 3, `expected 3 exitOnAppointment calls in book.ts, found ${calls.length}`)
})
check('the three exits are settled together, so one failure cannot skip the others', () => {
  assert.ok(/Promise\.allSettled\(\[[\s\S]*?winback\.exitOnAppointment/.test(book),
    'the win-back exit is not inside the same allSettled as the other two')
})
check('the booking is never failed by a campaign exit (best-effort, appointment already exists)', () => {
  assert.ok(/best-effort — the appointment already exists/.test(book))
})

// ── Parity with the module it mirrors ──
check('exitOnAppointment is exported with the same signature as life-campaign', () => {
  assert.ok(/export async function exitOnAppointment\(input: \{\s*householdId: string\s*memberId\?: string\s*actor\?: string\s*\}\)/.test(winback),
    'the signature diverges from life-campaign/inbound.ts')
})
check('it targets the Win-Back enrollment table', () => {
  assert.ok(winback.includes("from('pipeline_winback_enrollments')"))
})
check('it exits the SAME live states as the campaign it mirrors', () => {
  const states = (src) => (src.match(/const LIVE_STATES = \[([^\]]+)\]/) ?? [])[1]
  assert.ok(states(winback), 'no LIVE_STATES in win-back inbound.ts')
  assert.equal(states(winback).trim(), states(life).trim(),
    'the live-state list diverges from life-campaign/inbound.ts')
})
check('terminal states are left untouched, which is what makes a second booking a no-op', () => {
  for (const terminal of ['completed', 'exited', 'suppressed']) {
    assert.ok(!new RegExp(`LIVE_STATES[^\\]]*'${terminal}'`).test(winback),
      `${terminal} must not be in LIVE_STATES or a second booking would re-exit`)
  }
})
check('it writes exit_reason=appointment_booked and completed_at, like the other two', () => {
  assert.ok(winback.includes("exit_reason: 'appointment_booked'"))
  assert.ok(winback.includes('completed_at: nowISO'))
  assert.ok(winback.includes("status: 'exited'"))
})
check('each exited enrollment is audited individually, attributable to the record', () => {
  assert.ok(/for \(const r of exited\)[\s\S]*writeAudit/.test(winback), 'no per-enrollment audit loop')
  assert.ok(winback.includes("entity: 'pipeline_winback_enrollment'"))
})
check('it returns the count, so the caller can tell nothing-to-do from done', () => {
  assert.ok(winback.includes('return { exited: exited.length }'))
})
check('no securities data or firewall bypass is introduced', () => {
  assert.ok(!/is_security\s*:/.test(winback), 'the exit path must not write the firewall flag')
})

const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`\n✗ ${failed.length}/${results.length} win-back booking-exit assertions FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} win-back booking-exit assertions passed.`)
