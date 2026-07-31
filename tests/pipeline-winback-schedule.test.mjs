// Pipeline Win-Back Campaign — schedule/timing engine (pure, no DB/clock). Mirrors the
// tsc-compile-then-require pattern of tests/life-campaign-schedule.test.mjs. Proves the exact
// 24-touch, 120-day cadence from spec §7 (owner-confirmed 120 days, ADR-031), the channel mix,
// the no-back-to-back-repeat invariant, and per-enrollment plan computation.
// Run: node tests/pipeline-winback-schedule.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-pwb-sched-'))
execSync(
  `npx tsc src/lib/pipeline-winback/schedule.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { TOUCH_SCHEDULE, CAMPAIGN_LENGTH_DAYS, computeTouchPlan, nextDueTouch } = require(join(out, 'schedule.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('TOUCH_SCHEDULE — the frozen §7 cadence (120 days)')

t('has exactly 24 touches numbered 1..24', () => {
  assert.equal(TOUCH_SCHEDULE.length, 24)
  assert.deepEqual(TOUCH_SCHEDULE.map((x) => x.touch_no), Array.from({ length: 24 }, (_, i) => i + 1))
})

t('channel mix is 8 email / 8 sms / 6 ai_conversation / 2 advisor_outreach', () => {
  const count = (k) => TOUCH_SCHEDULE.filter((x) => x.kind === k).length
  assert.equal(count('email'), 8)
  assert.equal(count('sms'), 8)
  assert.equal(count('ai_conversation'), 6)
  assert.equal(count('advisor_outreach'), 2)
})

t('day offsets match the §7 table exactly and end on Day 120', () => {
  const days = [1, 3, 7, 14, 18, 25, 35, 42, 49, 60, 70, 80, 90, 93, 96, 99, 102, 105, 108, 111, 114, 117, 119, 120]
  assert.deepEqual(TOUCH_SCHEDULE.map((x) => x.day_offset), days)
  assert.equal(CAMPAIGN_LENGTH_DAYS, 120)
  assert.equal(TOUCH_SCHEDULE[TOUCH_SCHEDULE.length - 1].day_offset, 120)
})

t('day offsets are strictly increasing (never two touches on the same day)', () => {
  for (let i = 1; i < TOUCH_SCHEDULE.length; i++) {
    assert.ok(TOUCH_SCHEDULE[i].day_offset > TOUCH_SCHEDULE[i - 1].day_offset, `touch ${TOUCH_SCHEDULE[i].touch_no} not after prior`)
  }
})

t('no two consecutive touches share a channel (whole schedule)', () => {
  for (let i = 1; i < TOUCH_SCHEDULE.length; i++) {
    assert.notEqual(TOUCH_SCHEDULE[i].kind, TOUCH_SCHEDULE[i - 1].kind, `touch ${TOUCH_SCHEDULE[i].touch_no} repeats ${TOUCH_SCHEDULE[i].kind}`)
  }
})

t('the Day 90–120 accelerated phase is touches 13–24 and alternates channels', () => {
  const tail = TOUCH_SCHEDULE.filter((x) => x.day_offset >= 90)
  assert.equal(tail.length, 12)
  assert.deepEqual(tail.map((x) => x.touch_no), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
})

console.log('computeTouchPlan — per-enrollment dated timeline')

t('anchors touch #1 to the baseline date and touch #24 to baseline+119 days', () => {
  const plan = computeTouchPlan('2026-01-01')
  assert.equal(plan.length, 24)
  assert.equal(plan[0].dueDate, '2026-01-01') // day_offset 1 == baseline day
  // day_offset 120 → baseline + 119 days → 2026-04-30
  assert.equal(plan[23].dueDate, '2026-04-30')
})

t('never schedules two touches on the same calendar day', () => {
  const plan = computeTouchPlan('2026-03-10')
  const days = plan.map((p) => p.dueDate)
  assert.equal(new Set(days).size, days.length)
})

console.log('nextDueTouch — cursor advance')

t('returns the touch after the given cursor, null past the end', () => {
  const n = nextDueTouch(0, '2026-01-01')
  assert.equal(n.touch_no, 1)
  assert.equal(nextDueTouch(24, '2026-01-01'), null)
})

console.log(`\n✓ pipeline-winback schedule: ${passed} assertions passed`)
