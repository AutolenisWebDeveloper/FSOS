// District Agent FS Nurture — schedule (the 40-touch / 365-day sequential curriculum).
// Mirrors the tsc-compile-then-require isolated pattern of the other campaign schedule tests:
// src/lib/district-nurture/schedule.ts is self-contained (no imports) so it compiles alone.
//
// Run: node tests/district-nurture-schedule.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const out = mkdtempSync(join(tmpdir(), 'fsos-dn-sched-'))
execSync(
  `npx tsc src/lib/district-nurture/schedule.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const S = require(join(out, 'schedule.js'))

console.log('\ndistrict-nurture schedule — shape')

t('40 touches over 365 days: 24 email, 12 sms, 4 advisor_outreach', () => {
  assert.equal(S.TOUCH_SCHEDULE.length, 40)
  assert.equal(S.CAMPAIGN_LENGTH_DAYS, 365)
  const byKind = (k) => S.TOUCH_SCHEDULE.filter((x) => x.kind === k).length
  assert.equal(byKind('email'), 24)
  assert.equal(byKind('sms'), 12)
  assert.equal(byKind('advisor_outreach'), 4)
})

t('touch_no is a contiguous 1..40 sequence', () => {
  const nums = S.TOUCH_SCHEDULE.map((x) => x.touch_no)
  assert.deepEqual(nums, Array.from({ length: 40 }, (_, i) => i + 1))
})

t('day_offset is strictly increasing and ends at 365', () => {
  const days = S.TOUCH_SCHEDULE.map((x) => x.day_offset)
  for (let i = 1; i < days.length; i++) assert.ok(days[i] > days[i - 1], `day ${days[i]} not after ${days[i - 1]}`)
  assert.equal(Math.max(...days), 365)
})

t('curriculum is sequential: module_no never decreases (never reordered)', () => {
  let lastModule = 0
  for (const touch of S.TOUCH_SCHEDULE) {
    if (touch.module_no == null) continue // live touchpoints span modules
    assert.ok(touch.module_no >= lastModule, `module ${touch.module_no} appears after ${lastModule}`)
    lastModule = touch.module_no
  }
  assert.equal(lastModule, 12)
})

t('every module has exactly two emails and one sms', () => {
  for (let m = 1; m <= 12; m++) {
    const mod = S.TOUCH_SCHEDULE.filter((x) => x.module_no === m)
    assert.equal(mod.filter((x) => x.kind === 'email').length, 2, `module ${m} emails`)
    assert.equal(mod.filter((x) => x.kind === 'sms').length, 1, `module ${m} sms`)
  }
})

t('the four live touchpoints fall at the quarter boundaries', () => {
  const live = S.TOUCH_SCHEDULE.filter((x) => x.kind === 'advisor_outreach').map((x) => x.day_offset)
  assert.deepEqual(live, [90, 180, 270, 365])
})

console.log('\ndistrict-nurture schedule — date math')

t('addDays is UTC-midnight stable', () => {
  assert.equal(S.addDays('2026-01-01', 30), '2026-01-31')
  assert.equal(S.addDays('2026-02-28', 1), '2026-03-01')
})

t('computeTouchPlan dates Day 1 on the baseline and Day 365 a year out', () => {
  const plan = S.computeTouchPlan('2026-01-01')
  assert.equal(plan.length, 40)
  assert.equal(plan[0].touch_no, 1)
  assert.equal(plan[0].dueDate, '2026-01-01') // day_offset 1 → baseline
  const last = plan[plan.length - 1]
  assert.equal(last.touch_no, 40)
  assert.equal(last.dueDate, S.addDays('2026-01-01', 364)) // day_offset 365
})

t('nextDueTouch walks the cursor forward and stops at the end', () => {
  assert.equal(S.nextDueTouch(0, '2026-01-01').touch_no, 1)
  assert.equal(S.nextDueTouch(1, '2026-01-01').touch_no, 2)
  assert.equal(S.nextDueTouch(40, '2026-01-01'), null)
})

console.log(`\n✓ district-nurture-schedule: ${passed} assertions passed`)
