// Shared booking/reschedule calendar model (src/components/public/booking/calendar-model.ts) —
// pure, DB-free. Proves the today-floor, in-month earliest-available selection, and the
// initial-month choice, with explicit RESCHEDULE-context cases (moving off an existing
// appointment behaves differently from a fresh booking). Run: node tests/booking-calendar-model.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-calmodel-'))
execSync(
  `npx tsc src/components/public/booking/calendar-model.ts --outDir ${out} --module commonjs ` +
    `--target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  monthOf,
  firstOfMonthKey,
  monthPrefixOf,
  addMonths,
  fetchFromKey,
  firstOpenDayInMonth,
  initialMonth,
  canGoToPrevMonth,
} = require(join(out, 'calendar-model.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

t('monthOf / firstOfMonthKey / monthPrefixOf basics + year rollover', () => {
  assert.deepEqual(monthOf('2026-08-03'), { year: 2026, month0: 7 })
  assert.equal(firstOfMonthKey({ year: 2026, month0: 7 }), '2026-08-01')
  assert.equal(monthPrefixOf({ year: 2026, month0: 7 }), '2026-08')
  assert.deepEqual(addMonths({ year: 2026, month0: 11 }, 1), { year: 2027, month0: 0 })
  assert.deepEqual(addMonths({ year: 2026, month0: 0 }, -1), { year: 2025, month0: 11 })
})

t('fetchFromKey never requests the past — later of month-first and today', () => {
  // Current month: first-of-month is before today → fetch from today.
  assert.equal(fetchFromKey({ year: 2026, month0: 7 }, '2026-08-15'), '2026-08-15')
  // Future month: first-of-month is after today → fetch from the month's first day.
  assert.equal(fetchFromKey({ year: 2026, month0: 8 }, '2026-08-15'), '2026-09-01')
  // Equality boundary: today IS the first of the month → that day (not before it).
  assert.equal(fetchFromKey({ year: 2026, month0: 7 }, '2026-08-01'), '2026-08-01')
})

t('firstOpenDayInMonth returns the in-month earliest, ignoring spill into the next month', () => {
  // A 42-day fetch from Aug can include September days; only August ones are selectable.
  const keys = ['2026-09-02', '2026-08-20', '2026-08-13', '2026-09-01']
  assert.equal(firstOpenDayInMonth(keys, '2026-08'), '2026-08-13')
  assert.equal(firstOpenDayInMonth(keys, '2026-09'), '2026-09-01')
  // No open day in the visible month → null (so the "no openings this month" state can show).
  assert.equal(firstOpenDayInMonth(['2026-09-02'], '2026-08'), null)
  assert.equal(firstOpenDayInMonth([], '2026-08'), null)
})

t('initialMonth — BOOKING (no anchor) opens the current month', () => {
  assert.deepEqual(initialMonth('2026-08-15'), { year: 2026, month0: 7 })
  assert.deepEqual(initialMonth('2026-08-15', null), { year: 2026, month0: 7 })
})

t('initialMonth — RESCHEDULE off a FUTURE appointment opens the appointment’s month', () => {
  // The existing appointment is in October; today is in August → land on October, not August.
  assert.deepEqual(initialMonth('2026-08-15', '2026-10-06'), { year: 2026, month0: 9 })
  // Appointment later THIS month → still the current month (same result), not a jump.
  assert.deepEqual(initialMonth('2026-08-15', '2026-08-28'), { year: 2026, month0: 7 })
})

t('initialMonth — RESCHEDULE off a PAST/earlier appointment is floored to today’s month', () => {
  // Appointment already passed (last month) → never open a month before today.
  assert.deepEqual(initialMonth('2026-08-15', '2026-07-30'), { year: 2026, month0: 7 })
  // Earlier THIS month than today → today’s month (floor), not the past day’s.
  assert.deepEqual(initialMonth('2026-08-15', '2026-08-02'), { year: 2026, month0: 7 })
})

t('initialMonth — RESCHEDULE across a YEAR boundary opens the future appointment’s month', () => {
  assert.deepEqual(initialMonth('2026-12-15', '2027-01-10'), { year: 2027, month0: 0 })
})

t('canGoToPrevMonth — today’s month is the floor', () => {
  assert.equal(canGoToPrevMonth({ year: 2026, month0: 7 }, '2026-08-15'), false) // same month
  assert.equal(canGoToPrevMonth({ year: 2026, month0: 8 }, '2026-08-15'), true) // next month
  assert.equal(canGoToPrevMonth({ year: 2027, month0: 0 }, '2026-08-15'), true) // next year
})

console.log(`\nAll ${passed} assertions passed.`)
