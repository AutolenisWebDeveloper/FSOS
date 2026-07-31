// Cross-Sell Life Campaign — frozen 35-touch / 180-day cadence proof (spec §6).
// Compiles the PURE, dependency-free schedule core (src/lib/cross-sell-life/schedule.ts) in
// isolation (no Supabase) and asserts the timeline invariants the tick service + seed migration
// (086) both derive from: exact touch count, channel mix, strictly-increasing distinct day
// offsets, the day-1/day-180 anchors, distinct calendar dates from a baseline, and the
// weekend/holiday business-day deferral helper.
// Run: node tests/cross-sell-life-schedule.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-schedule-'))
execSync(
  `npx tsc src/lib/cross-sell-life/schedule.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  TOUCH_SCHEDULE,
  TOTAL_TOUCHES,
  CAMPAIGN_DAYS,
  computeTouchPlan,
  nextDueTouch,
  addDays,
  isoWeekday,
  deferToBusinessDay,
} = require(join(out, 'schedule.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('Touch-count + channel-mix invariants (§6)')

t('exactly 35 touches; TOTAL_TOUCHES === 35; CAMPAIGN_DAYS === 180', () => {
  assert.equal(TOUCH_SCHEDULE.length, 35)
  assert.equal(TOTAL_TOUCHES, 35)
  assert.equal(CAMPAIGN_DAYS, 180)
})

t('channel mix is exactly 12 email + 12 sms + 7 ai_conversation + 4 advisor_outreach', () => {
  const counts = TOUCH_SCHEDULE.reduce((acc, tch) => {
    acc[tch.kind] = (acc[tch.kind] ?? 0) + 1
    return acc
  }, {})
  assert.deepEqual(counts, { email: 12, sms: 12, ai_conversation: 7, advisor_outreach: 4 })
})

console.log('Timing anchors + ordering')

t('day_offsets are strictly increasing and distinct', () => {
  const offsets = TOUCH_SCHEDULE.map((tch) => tch.day_offset)
  for (let i = 1; i < offsets.length; i++) {
    assert.ok(offsets[i] > offsets[i - 1], `offset ${offsets[i]} must exceed ${offsets[i - 1]}`)
  }
  assert.equal(new Set(offsets).size, offsets.length)
})

t('touch_no values are the contiguous sequence 1..35', () => {
  assert.deepEqual(
    TOUCH_SCHEDULE.map((tch) => tch.touch_no),
    Array.from({ length: 35 }, (_, i) => i + 1),
  )
})

t('first touch is day_offset 1 (touch_no 1)', () => {
  assert.equal(TOUCH_SCHEDULE[0].touch_no, 1)
  assert.equal(TOUCH_SCHEDULE[0].day_offset, 1)
})

t('last touch is day_offset 180 (touch_no 35)', () => {
  const last = TOUCH_SCHEDULE[TOUCH_SCHEDULE.length - 1]
  assert.equal(last.touch_no, 35)
  assert.equal(last.day_offset, 180)
})

console.log('computeTouchPlan — dated timeline from a baseline')

t('computeTouchPlan produces 35 distinct calendar dates (no two touches share a day)', () => {
  const plan = computeTouchPlan('2026-01-01')
  assert.equal(plan.length, 35)
  const dates = plan.map((p) => p.dueDate)
  assert.equal(new Set(dates).size, 35)
})

t('day 1 lands on the baseline; day 180 lands baseline + 179 days', () => {
  const plan = computeTouchPlan('2026-01-01')
  assert.equal(plan[0].dueDate, '2026-01-01')
  assert.equal(plan[plan.length - 1].dueDate, addDays('2026-01-01', 179))
})

t('nextDueTouch(0) is touch #1; nextDueTouch(35) is null (timeline exhausted)', () => {
  const first = nextDueTouch(0, '2026-01-01')
  assert.equal(first.touch_no, 1)
  assert.equal(first.dueDate, '2026-01-01')
  assert.equal(nextDueTouch(35, '2026-01-01'), null)
})

console.log('deferToBusinessDay — weekend + holiday suppression')

// Anchor the weekday assumptions so the test never silently drifts on a bad date.
t('anchor weekdays: 2026-08-01 Sat, 2026-08-02 Sun, 2026-08-03 Mon, 2026-07-28 Tue', () => {
  assert.equal(isoWeekday('2026-08-01'), 6) // Saturday
  assert.equal(isoWeekday('2026-08-02'), 0) // Sunday
  assert.equal(isoWeekday('2026-08-03'), 1) // Monday
  assert.equal(isoWeekday('2026-07-28'), 2) // Tuesday
})

t('a Saturday defers to Monday when sendOnWeekends=false', () => {
  assert.equal(
    deferToBusinessDay('2026-08-01', { sendOnWeekends: false, sendOnHolidays: false, holidays: [] }),
    '2026-08-03',
  )
})

t('a Sunday defers to Monday when sendOnWeekends=false', () => {
  assert.equal(
    deferToBusinessDay('2026-08-02', { sendOnWeekends: false, sendOnHolidays: false, holidays: [] }),
    '2026-08-03',
  )
})

t('a weekday is left unchanged', () => {
  assert.equal(
    deferToBusinessDay('2026-07-28', { sendOnWeekends: false, sendOnHolidays: false, holidays: [] }),
    '2026-07-28',
  )
})

t('a weekend is left unchanged when sendOnWeekends=true', () => {
  assert.equal(
    deferToBusinessDay('2026-08-01', { sendOnWeekends: true, sendOnHolidays: false, holidays: [] }),
    '2026-08-01',
  )
})

t('a holiday is skipped unless sendOnHolidays=true', () => {
  // 2026-07-28 (Tue) as a holiday → pushes to the next allowed day 2026-07-29.
  assert.equal(isoWeekday('2026-07-29'), 3) // Wednesday (still a business day)
  assert.equal(
    deferToBusinessDay('2026-07-28', { sendOnWeekends: false, sendOnHolidays: false, holidays: ['2026-07-28'] }),
    '2026-07-29',
  )
  // Same date is untouched when holidays are permitted.
  assert.equal(
    deferToBusinessDay('2026-07-28', { sendOnWeekends: false, sendOnHolidays: true, holidays: ['2026-07-28'] }),
    '2026-07-28',
  )
})

console.log(`\nAll ${passed} assertions passed.`)
