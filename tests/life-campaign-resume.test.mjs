// Life Conversion Campaign — resume-without-catch-up proof (D5 / §4b).
// Compiles the PURE resume core (src/lib/life-campaign/resume.ts) + its schedule dependency in
// isolation (no Supabase) and asserts the corrected behavior: on resume, touches that came due
// while the campaign was paused are recorded SKIPPED and the cadence fast-forwards to the next
// FUTURE touch — never fired late as a one-per-tick burst. Replay is the deliberate opt-in
// catch-up. This is the regression guard for the delayed-catch-up defect.
// Run: node tests/life-campaign-resume.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-life-resume-'))
execSync(
  `npx tsc src/lib/life-campaign/resume.ts src/lib/life-campaign/schedule.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { planResume, kindForTouch } = require(join(out, 'resume.js'))
const { computeTouchPlan, TOUCH_SCHEDULE } = require(join(out, 'schedule.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// Baseline Day 1 = 2026-01-01. The plan places touch #1 on 2026-01-01, #2 on 2026-01-04, etc.
// planResume is schedule-agnostic: the caller passes the dated plan (here Life's 20-touch cadence).
const BASELINE = '2026-01-01'
const plan = computeTouchPlan(BASELINE)
const dueOf = (no) => plan.find((p) => p.touch_no === no).dueDate
const resume = (currentTouchNo, today, replay) => planResume({ plan, currentTouchNo, today, replay })

console.log('Skip policy — the default, no catch-up (§4b)')

t('touches that came due while paused are recorded skipped, cadence jumps to the first future touch', () => {
  // Cursor at 2 (touches 1–2 fired). Paused a long time; resume "today" sits between touch #6 and #7.
  const today = dueOf(7) // exactly touch #7's due date → #7 is due "today" (not past), #3–#6 are past
  const r = resume(2, today, 'skip')
  assert.deepEqual(r.skippedTouchNos, [3, 4, 5, 6], 'the four intervening past-due touches are skipped')
  assert.equal(r.newCursor, 6, 'cursor advanced past every skipped touch')
  assert.equal(r.nextTouchAt, `${dueOf(7)}T13:00:00.000Z`, 'next_touch_at is the first non-past touch (#7)')
  assert.equal(r.complete, false)
})

t('a touch due EXACTLY today is not skipped — it becomes the next touch', () => {
  const today = dueOf(3)
  const r = resume(2, today, 'skip')
  assert.deepEqual(r.skippedTouchNos, [], 'nothing is strictly past-due')
  assert.equal(r.newCursor, 2)
  assert.equal(r.nextTouchAt, `${dueOf(3)}T13:00:00.000Z`)
})

t('no burst: resuming never returns more than one due touch (next_touch_at is a single future date)', () => {
  // Even after a huge gap, exactly ONE next_touch_at is produced (or completion) — never a list of
  // due touches to fire back-to-back.
  const today = dueOf(15)
  const r = resume(1, today, 'skip')
  assert.equal(typeof r.nextTouchAt, 'string')
  assert.equal(r.nextTouchAt, `${dueOf(15)}T13:00:00.000Z`)
  // Everything between the cursor and #15 is skipped, not queued to fire.
  assert.deepEqual(r.skippedTouchNos, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  assert.equal(r.complete, false)
})

t('resuming after the whole cadence is past-due skips the remainder and completes', () => {
  const today = '2027-01-01' // long after touch #20 (day 180 ≈ 2026-06-29)
  const r = resume(5, today, 'skip')
  assert.deepEqual(r.skippedTouchNos, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.equal(r.newCursor, 20)
  assert.equal(r.nextTouchAt, null)
  assert.equal(r.complete, true, 'no future touch remains → complete, not re-activate')
})

t('a cursor already at the final touch completes with nothing skipped', () => {
  const r = resume(TOUCH_SCHEDULE.length, dueOf(1), 'skip')
  assert.deepEqual(r.skippedTouchNos, [])
  assert.equal(r.nextTouchAt, null)
  assert.equal(r.complete, true)
})

console.log('Replay policy — deliberate opt-in catch-up')

t('replay records NO skips and fires the next pending touch immediately (today), not late', () => {
  const today = dueOf(10)
  const r = resume(2, today, 'replay')
  assert.deepEqual(r.skippedTouchNos, [], 'replay never skips')
  assert.equal(r.newCursor, 2, 'cursor unchanged — the next pending touch (#3) fires next')
  assert.equal(r.nextTouchAt, `${today}T13:00:00.000Z`, 'scheduled for now, not its long-past original date')
  assert.equal(r.complete, false)
})

t('replay on an exhausted timeline completes', () => {
  const r = resume(TOUCH_SCHEDULE.length, dueOf(1), 'replay')
  assert.equal(r.nextTouchAt, null)
  assert.equal(r.complete, true)
})

console.log('Skipped-execution metadata')

t('kindForTouch returns the plan channel for each touch, null out of range', () => {
  assert.equal(kindForTouch(plan, 1), 'email')
  assert.equal(kindForTouch(plan, 2), 'sms')
  assert.equal(kindForTouch(plan, 7), 'advisor_outreach')
  assert.equal(kindForTouch(plan, 0), null)
  assert.equal(kindForTouch(plan, 999), null)
  assert.equal(plan.length, TOUCH_SCHEDULE.length)
})

console.log(`\nAll ${passed} assertions passed.`)
