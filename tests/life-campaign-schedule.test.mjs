// Life Conversion Campaign — schedule/timing engine (pure, no DB/clock). Mirrors the
// tsc-compile-then-require pattern of tests/comms-conversation.test.mjs.
// Proves the exact 20-touch, 180-day cadence from spec §5, the channel-alternation
// invariant of the Day 135–180 acceleration phase, and per-enrollment plan computation.
// Run: node tests/life-campaign-schedule.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-sched-'))
execSync(
  `npx tsc src/lib/life-campaign/schedule.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { TOUCH_SCHEDULE, computeTouchPlan, nextDueTouch, earlyEnrollmentFits } = require(join(out, 'schedule.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('TOUCH_SCHEDULE — the frozen §5 cadence')

t('has exactly 20 touches numbered 1..20', () => {
  assert.equal(TOUCH_SCHEDULE.length, 20)
  assert.deepEqual(TOUCH_SCHEDULE.map((x) => x.touch_no), Array.from({ length: 20 }, (_, i) => i + 1))
})

t('channel mix is 7 email / 6 sms / 5 ai_conversation / 2 advisor_outreach', () => {
  const count = (k) => TOUCH_SCHEDULE.filter((x) => x.kind === k).length
  assert.equal(count('email'), 7)
  assert.equal(count('sms'), 6)
  assert.equal(count('ai_conversation'), 5)
  assert.equal(count('advisor_outreach'), 2)
})

t('day offsets match the §5 table exactly', () => {
  const days = [1, 4, 8, 15, 24, 35, 48, 60, 75, 90, 105, 120, 135, 145, 152, 158, 165, 171, 176, 180]
  assert.deepEqual(TOUCH_SCHEDULE.map((x) => x.day_offset), days)
})

t('the Day 135–180 acceleration phase never repeats a channel back-to-back', () => {
  const tail = TOUCH_SCHEDULE.filter((x) => x.day_offset >= 135)
  for (let i = 1; i < tail.length; i++) {
    assert.notEqual(tail[i].kind, tail[i - 1].kind, `touch ${tail[i].touch_no} repeats ${tail[i].kind}`)
  }
})

console.log('computeTouchPlan — per-enrollment dated timeline')

t('anchors touch #1 to the baseline date and touch #20 to baseline+179 days', () => {
  const plan = computeTouchPlan('2026-01-01')
  assert.equal(plan.length, 20)
  assert.equal(plan[0].dueDate, '2026-01-01') // day_offset 1 == baseline day
  // day_offset 180 → baseline + 179 days → 2026-06-29
  assert.equal(plan[19].dueDate, '2026-06-29')
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
  assert.equal(nextDueTouch(20, '2026-01-01'), null)
})

console.log('earlyEnrollmentFits — deadline safety')

t('rejects enrollment when Day 180 would land after the deadline minus buffer', () => {
  // baseline 2026-01-01, needs 180 days + 30 buffer → deadline must be >= ~2026-07-30
  assert.equal(earlyEnrollmentFits('2026-06-01', '2026-01-01', 30), false)
  assert.equal(earlyEnrollmentFits('2026-12-01', '2026-01-01', 30), true)
})

console.log(`\n✓ life-campaign schedule: ${passed} assertions passed`)
