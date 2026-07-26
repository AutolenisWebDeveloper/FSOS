// Native booking — pure availability calculator proof (src/lib/booking/availability.ts +
// timezone.ts). Compiles the DB-free modules in isolation (no Supabase) and asserts the
// hard parts of a booking engine (§1): DST-correct timezone rendering, buffer math,
// min-notice / max-lead / max-per-day enforcement, blackout + external-busy subtraction,
// and that an existing appointment removes exactly its slot (the calculator half of
// double-booking; the DB unique index is the other half — mig 069).
// Run: node tests/booking-availability.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-booking-'))
execSync(
  `npx tsc src/lib/booking/availability.ts src/lib/booking/timezone.ts --outDir ${out} ` +
    `--rootDir src/lib/booking --module commonjs --target es2020 --moduleResolution node ` +
    `--skipLibCheck --esModuleInterop --lib es2020`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { computeAvailableSlots, overlaps, withinMinNotice, withinMaxLead } = require(join(out, 'availability.js'))
const { weekdayOfDate, zonedTimeToUtc, getOffsetMinutes, localDateKey } = require(join(out, 'timezone.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

// A UTC-zone type/rule keeps wall clock == UTC so slot instants are trivial to reason about.
function utcType(over = {}) {
  return {
    durationMinutes: 60,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    maxLeadDays: 365,
    maxPerDay: null,
    slotIntervalMinutes: 60,
    ...over,
  }
}
// 2026-07-27; the rule weekday is derived so the test never hardcodes a day-of-week.
const MON = '2026-07-27'
const monWeekday = weekdayOfDate(2026, 7, 27)
function utcRule(over = {}) {
  return { weekday: monWeekday, startTime: '09:00', endTime: '12:00', timezone: 'UTC', ...over }
}
const dayReq = (over = {}) => ({
  type: utcType(),
  rules: [utcRule()],
  rangeStart: `${MON}T00:00:00Z`,
  rangeEnd: `${MON}T23:59:59Z`,
  bookerTimezone: 'UTC',
  now: '2026-07-20T00:00:00Z',
  ...over,
})
const starts = (slots) => slots.map((s) => s.startsAt)

console.log('Pure predicates')
t('overlaps is half-open — touching edges do not overlap', () => {
  assert.equal(overlaps(0, 10, 10, 20), false)
  assert.equal(overlaps(0, 10, 9, 20), true)
  assert.equal(overlaps(5, 15, 0, 10), true)
})
t('withinMinNotice / withinMaxLead bound the slot start', () => {
  const now = Date.parse('2026-07-20T00:00:00Z')
  assert.equal(withinMinNotice(now + 60 * 60000, now, 120), false) // 1h out, 2h notice
  assert.equal(withinMinNotice(now + 180 * 60000, now, 120), true)
  assert.equal(withinMaxLead(now + 5 * 86400000, now, 10), true)
  assert.equal(withinMaxLead(now + 11 * 86400000, now, 10), false)
})

console.log('Basic slot generation')
t('a 9–12 rule with 60m duration/interval yields 09:00, 10:00, 11:00', () => {
  const slots = computeAvailableSlots(dayReq())
  assert.deepEqual(starts(slots), [`${MON}T09:00:00.000Z`, `${MON}T10:00:00.000Z`, `${MON}T11:00:00.000Z`])
  assert.equal(slots[0].durationMinutes, 60)
  assert.equal(slots[0].localTime, '09:00')
  assert.equal(slots[0].localDate, MON)
})
t('slot interval independent of duration (30m interval, 60m duration)', () => {
  const slots = computeAvailableSlots(dayReq({ type: utcType({ slotIntervalMinutes: 30 }) }))
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['09:00', '09:30', '10:00', '10:30', '11:00'],
  )
})
t('a slot never runs past the rule end (duration must fit)', () => {
  // 09:00–10:00 rule, 45m duration, 15m interval → 09:00 and 09:15 only (09:15–10:00 fits).
  const slots = computeAvailableSlots(
    dayReq({ type: utcType({ durationMinutes: 45, slotIntervalMinutes: 15 }), rules: [utcRule({ endTime: '10:00' })] }),
  )
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['09:00', '09:15'],
  )
})
t('an inactive rule produces nothing', () => {
  const slots = computeAvailableSlots(dayReq({ rules: [utcRule({ active: false })] }))
  assert.equal(slots.length, 0)
})

console.log('Timezone rendering (booker vs host zone)')
t('a Chicago-hosted slot renders in the booker (New York) zone, +1h', () => {
  const slots = computeAvailableSlots(
    dayReq({
      rules: [utcRule({ timezone: 'America/Chicago' })],
      bookerTimezone: 'America/New_York',
    }),
  )
  // 09:00 Chicago (CDT, -05:00) == 10:00 New York (EDT, -04:00).
  assert.equal(slots[0].localTime, '10:00')
  assert.equal(slots[0].offset, '-04:00')
  assert.match(slots[0].label, /10:00\s?AM/i)
})

console.log('DST correctness (the 9:00 AM rule stays 9:00 AM local across the shift)')
t('a 9:00 AM Chicago rule is 09:00 local both before and after spring-forward', () => {
  // US DST 2026 begins Sun Mar 8. Mar 2 (CST, -06:00) and Mar 9 (CDT, -05:00) are both Mondays.
  const w = weekdayOfDate(2026, 3, 2)
  assert.equal(weekdayOfDate(2026, 3, 9), w)
  const slots = computeAvailableSlots({
    type: utcType({ durationMinutes: 60, slotIntervalMinutes: 60 }),
    rules: [{ weekday: w, startTime: '09:00', endTime: '10:00', timezone: 'America/Chicago' }],
    rangeStart: '2026-03-01T00:00:00Z',
    rangeEnd: '2026-03-15T00:00:00Z',
    bookerTimezone: 'America/Chicago',
    now: '2026-02-01T00:00:00Z',
  })
  const mar2 = slots.find((s) => s.localDate === '2026-03-02')
  const mar9 = slots.find((s) => s.localDate === '2026-03-09')
  assert.ok(mar2 && mar9, 'both Mondays present')
  // Same wall-clock local time on both sides of the transition…
  assert.equal(mar2.localTime, '09:00')
  assert.equal(mar9.localTime, '09:00')
  // …but different UTC instants and offsets (CST -06:00 → 15:00Z; CDT -05:00 → 14:00Z).
  assert.equal(mar2.offset, '-06:00')
  assert.equal(mar9.offset, '-05:00')
  assert.equal(mar2.startsAt, '2026-03-02T15:00:00.000Z')
  assert.equal(mar9.startsAt, '2026-03-09T14:00:00.000Z')
})
t('zonedTimeToUtc round-trips a wall time through the correct offset', () => {
  const inst = zonedTimeToUtc(2026, 7, 27, 9, 0, 'America/Chicago')
  assert.equal(inst.toISOString(), '2026-07-27T14:00:00.000Z') // 09:00 CDT
  assert.equal(getOffsetMinutes(inst, 'America/Chicago'), -300)
})

console.log('Existing-appointment subtraction (calculator half of double-booking)')
t('an appointment at a slot removes exactly that slot', () => {
  const slots = computeAvailableSlots(
    dayReq({ existingAppointments: [{ startsAt: `${MON}T10:00:00Z`, endsAt: `${MON}T11:00:00Z` }] }),
  )
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['09:00', '11:00'],
  )
})

console.log('Buffer math')
t('30m buffers around an 11:00 appointment block the adjacent slots', () => {
  const slots = computeAvailableSlots(
    dayReq({
      type: utcType({ bufferBeforeMinutes: 30, bufferAfterMinutes: 30 }),
      rules: [utcRule({ endTime: '14:00' })], // 09,10,11,12,13
      existingAppointments: [{ startsAt: `${MON}T11:00:00Z`, endsAt: `${MON}T12:00:00Z` }],
    }),
  )
  // 10:00, 11:00, 12:00 fall inside the buffered footprint; 09:00 and 13:00 survive.
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['09:00', '13:00'],
  )
})

console.log('Min-notice / max-lead / effective range')
t('min-notice removes slots too soon from now', () => {
  const slots = computeAvailableSlots(
    dayReq({ type: utcType({ minNoticeMinutes: 120 }), now: `${MON}T08:00:00Z` }),
  )
  // now 08:00 + 2h notice ⇒ earliest 10:00.
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['10:00', '11:00'],
  )
})
t('max-lead removes slots beyond the horizon', () => {
  const slots = computeAvailableSlots(
    dayReq({ type: utcType({ maxLeadDays: 3 }), now: '2026-07-20T00:00:00Z' }),
  )
  // 2026-07-27 is 7 days out; horizon is 3 days ⇒ nothing.
  assert.equal(slots.length, 0)
})
t('a rule outside its effective range yields nothing', () => {
  const slots = computeAvailableSlots(dayReq({ rules: [utcRule({ effectiveStart: '2026-08-01' })] }))
  assert.equal(slots.length, 0)
})

console.log('Per-day capacity')
t('a day already at max_per_day offers no slots', () => {
  const existing = [
    { startsAt: `${MON}T07:00:00Z`, endsAt: `${MON}T08:00:00Z` }, // before hours, no overlap
    { startsAt: `${MON}T08:00:00Z`, endsAt: `${MON}T08:30:00Z` },
  ]
  const full = computeAvailableSlots(dayReq({ type: utcType({ maxPerDay: 2 }), existingAppointments: existing }))
  assert.equal(full.length, 0)
  const room = computeAvailableSlots(dayReq({ type: utcType({ maxPerDay: 3 }), existingAppointments: existing }))
  assert.deepEqual(
    room.map((s) => s.localTime),
    ['09:00', '10:00', '11:00'],
  )
})

console.log('Blackouts + external busy (Google busy-sync forward-compat)')
t('a blackout removes overlapping slots', () => {
  const slots = computeAvailableSlots(
    dayReq({ blackouts: [{ startsAt: `${MON}T10:00:00Z`, endsAt: `${MON}T10:30:00Z` }] }),
  )
  assert.deepEqual(
    slots.map((s) => s.localTime),
    ['09:00', '11:00'],
  )
})
t('external busy subtracts like a blackout; empty is a no-op', () => {
  const noop = computeAvailableSlots(dayReq({ externalBusy: [] }))
  assert.equal(noop.length, 3)
  const busy = computeAvailableSlots(
    dayReq({ externalBusy: [{ startsAt: `${MON}T09:30:00Z`, endsAt: `${MON}T09:45:00Z` }] }),
  )
  assert.deepEqual(
    busy.map((s) => s.localTime),
    ['10:00', '11:00'],
  )
})

console.log('capacity day-bucketing uses the host zone')
t('localDateKey buckets an instant by the given zone', () => {
  // 03:00Z on the 28th is still the 27th in Chicago (-05:00 CDT).
  assert.equal(localDateKey(new Date('2026-07-28T03:00:00Z'), 'America/Chicago'), '2026-07-27')
  assert.equal(localDateKey(new Date('2026-07-28T03:00:00Z'), 'UTC'), '2026-07-28')
})

console.log(`\nAll ${passed} assertions passed.`)
