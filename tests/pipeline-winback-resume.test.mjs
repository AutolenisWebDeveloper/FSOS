// Pipeline Win-Back Campaign — resume-without-catch-up proof (C2/D5 / §5a).
// Win-Back reuses the SHARED, schedule-agnostic resume core (life-campaign/resume.ts) fed its OWN
// 24-touch cadence (pipeline-winback/schedule.ts). This proves the no-catch-up behavior holds on the
// Win-Back timeline: touches that came due while paused are recorded Skipped and the cadence
// fast-forwards to the next FUTURE touch — never a delayed one-per-tick burst.
// Run: node tests/pipeline-winback-resume.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-winback-resume-'))
// resume.ts re-exports life's schedule, so compile it alongside; add Win-Back's schedule for the plan.
execSync(
  `npx tsc src/lib/life-campaign/resume.ts src/lib/life-campaign/schedule.ts ` +
    `src/lib/pipeline-winback/schedule.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { planResume, kindForTouch } = require(join(out, 'life-campaign/resume.js'))
const { computeTouchPlan, TOUCH_SCHEDULE } = require(join(out, 'pipeline-winback/schedule.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const BASELINE = '2026-01-01'
const plan = computeTouchPlan(BASELINE)
const dueOf = (no) => plan.find((p) => p.touch_no === no).dueDate
const resume = (currentTouchNo, today, replay) => planResume({ plan, currentTouchNo, today, replay })

t('the Win-Back cadence is the 24-touch schedule (fixture sanity)', () => {
  assert.equal(TOUCH_SCHEDULE.length, 24)
  assert.equal(plan.length, 24)
})

console.log('Skip policy — no catch-up on the Win-Back timeline (§5a)')

t('past-due touches are recorded skipped; cadence jumps to the first future touch', () => {
  const today = dueOf(9) // #9 due today; the intervening touches after the cursor are past-due
  const r = resume(4, today, 'skip')
  assert.deepEqual(r.skippedTouchNos, [5, 6, 7, 8], 'touches 5–8 skipped')
  assert.equal(r.newCursor, 8)
  assert.equal(r.nextTouchAt, `${dueOf(9)}T13:00:00.000Z`)
  assert.equal(r.complete, false)
})

t('no burst: a long pause yields a single next_touch_at, never a queue of due touches', () => {
  const today = dueOf(20)
  const r = resume(2, today, 'skip')
  assert.equal(r.nextTouchAt, `${dueOf(20)}T13:00:00.000Z`)
  assert.equal(r.skippedTouchNos.length, 17) // touches 3..19
  assert.equal(r.skippedTouchNos[0], 3)
  assert.equal(r.skippedTouchNos.at(-1), 19)
  assert.equal(r.complete, false)
})

t('resuming past the final (24th) touch completes with the remainder skipped', () => {
  const today = '2028-01-01'
  const r = resume(21, today, 'skip')
  assert.deepEqual(r.skippedTouchNos, [22, 23, 24])
  assert.equal(r.newCursor, 24)
  assert.equal(r.nextTouchAt, null)
  assert.equal(r.complete, true)
})

console.log('Replay policy — deliberate opt-in catch-up')

t('replay fires the next pending touch immediately, skipping nothing', () => {
  const today = dueOf(12)
  const r = resume(6, today, 'replay')
  assert.deepEqual(r.skippedTouchNos, [])
  assert.equal(r.newCursor, 6)
  assert.equal(r.nextTouchAt, `${today}T13:00:00.000Z`)
  assert.equal(r.complete, false)
})

t('kindForTouch resolves Win-Back plan channels', () => {
  assert.equal(kindForTouch(plan, 1), 'email')
  assert.equal(kindForTouch(plan, 2), 'sms')
  assert.equal(kindForTouch(plan, 999), null)
})

console.log(`\nAll ${passed} assertions passed.`)
