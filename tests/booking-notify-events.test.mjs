// Native booking — pure lifecycle-classifier proof (src/lib/booking/notify-events.ts).
// Compiles the DB-free module in isolation and asserts the event→template mapping, the
// immediate-vs-reminder split, the relative-when copy, and the multi-offset due rule the
// P5 ledger-backed reminder pass depends on. Run: node tests/booking-notify-events.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-notify-events-'))
execSync(
  `npx tsc src/lib/booking/notify-events.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { LIFECYCLE_EVENTS, sourceKeyFor, isImmediateEvent, relativeWhen, dueReminderOffsets } = require(
  join(out, 'notify-events.js'),
)

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}
const HOUR = 3_600_000
const MIN = 60_000

console.log('event → template mapping')
t('the six lifecycle events are exactly the migration-093 event enum', () => {
  assert.deepEqual([...LIFECYCLE_EVENTS].sort(), [
    'cancellation',
    'confirmation',
    'no_show_followup',
    'recap',
    'reminder',
    'rescheduled',
  ])
})
t('email source keys match the registry-registered keys (real, reviewable drafts)', () => {
  assert.equal(sourceKeyFor('confirmation', 'email'), 'appointment-confirmation')
  assert.equal(sourceKeyFor('reminder', 'email'), 'appointment-reminder-email')
  assert.equal(sourceKeyFor('rescheduled', 'email'), 'appointment-rescheduled')
  assert.equal(sourceKeyFor('cancellation', 'email'), 'appointment-cancellation')
  assert.equal(sourceKeyFor('no_show_followup', 'email'), 'appointment-noshow')
  assert.equal(sourceKeyFor('recap', 'email'), 'appointment-recap')
})
t('every event maps to a distinct sms source key (Stage-4 targets)', () => {
  const keys = LIFECYCLE_EVENTS.map((e) => sourceKeyFor(e, 'sms'))
  assert.equal(new Set(keys).size, keys.length)
  for (const k of keys) assert.match(k, /-sms$/)
})
t('only the reminder is a per-offset event; the rest are immediate one-shots', () => {
  assert.equal(isImmediateEvent('reminder'), false)
  for (const e of ['confirmation', 'rescheduled', 'cancellation', 'no_show_followup', 'recap']) {
    assert.equal(isImmediateEvent(e), true)
  }
})

console.log('relativeWhen (approximate, never an exact instant)')
const now = new Date('2026-08-02T14:00:00Z')
t('~24h out reads "in about 24 hours"', () => {
  assert.equal(relativeWhen(new Date(now.getTime() + 24 * HOUR).toISOString(), now), 'in about 24 hours')
})
t('~1h out reads "in about an hour"', () => {
  assert.equal(relativeWhen(new Date(now.getTime() + HOUR).toISOString(), now), 'in about an hour')
})
t('~7d out reads "in 7 days"', () => {
  assert.equal(relativeWhen(new Date(now.getTime() + 7 * 24 * HOUR).toISOString(), now), 'in 7 days')
})
t('a past/invalid start yields empty string (never a negative phrase)', () => {
  assert.equal(relativeWhen(new Date(now.getTime() - HOUR).toISOString(), now), '')
  assert.equal(relativeWhen('not-a-date', now), '')
})

console.log('dueReminderOffsets (multi-offset, fire-once handled by the ledger)')
const start = '2026-08-03T14:00:00Z'
const earlyBooked = '2026-07-01T00:00:00Z'
const cand = (over = {}) => ({ status: 'scheduled', startsAt: start, bookedAt: earlyBooked, ...over })
t('only offsets whose window has opened are due', () => {
  const at23h = new Date('2026-08-02T15:00:00Z') // 23h before start
  // 1440 (24h) window is open; 60 (1h) window is not yet.
  assert.deepEqual(dueReminderOffsets(cand(), [1440, 60], at23h), [1440])
})
t('both offsets due once inside the tightest window; returned ascending', () => {
  const at30m = new Date('2026-08-03T13:30:00Z') // 30m before start
  assert.deepEqual(dueReminderOffsets(cand(), [1440, 60], at30m), [60, 1440])
})
t('nothing due before any window opens', () => {
  const at3d = new Date('2026-07-31T14:00:00Z')
  assert.deepEqual(dueReminderOffsets(cand(), [1440, 60], at3d), [])
})
t('nothing due once the appointment has started', () => {
  const after = new Date('2026-08-03T14:30:00Z')
  assert.deepEqual(dueReminderOffsets(cand(), [1440, 60], after), [])
})
t('a non-scheduled appointment is never due', () => {
  const at23h = new Date('2026-08-02T15:00:00Z')
  assert.deepEqual(dueReminderOffsets(cand({ status: 'cancelled' }), [1440], at23h), [])
})
t('an offset is suppressed when the booking landed inside its window (confirmation suffices)', () => {
  const at23h = new Date('2026-08-02T15:00:00Z')
  // Booked 20h before start → inside the 24h window but before the 1h window.
  const bookedLate = '2026-08-02T18:00:00Z'
  assert.deepEqual(dueReminderOffsets(cand({ bookedAt: bookedLate }), [1440, 60], at23h), [])
  // At 30m out, the 1h window opened AFTER the booking, so it is due; the 24h one stays suppressed.
  const at30m = new Date('2026-08-03T13:30:00Z')
  assert.deepEqual(dueReminderOffsets(cand({ bookedAt: bookedLate }), [1440, 60], at30m), [60])
})
t('invalid / duplicate / non-positive offsets are ignored', () => {
  const at23h = new Date('2026-08-02T15:00:00Z')
  assert.deepEqual(dueReminderOffsets(cand(), [1440, 1440, 0, -5, Number.NaN], at23h), [1440])
})

console.log(`\nAll ${passed} assertions passed.`)
