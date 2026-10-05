// Life Conversion enrollment sweep: no starvation, no daily duplicate advisor tasks (audit D-04).
//   • the sweep asks only for policies whose full cadence FITS (days_remaining ≥ 179 + buffer) —
//     the boundary must agree with schedule.ts earlyEnrollmentFits exactly, or a fitting policy is
//     never swept / a non-fitting one keeps crowding the window;
//   • policies already enrolled in ANY state are not re-swept;
//   • the "deadline too close" advisor task is created at most once per policy (select-before-insert).
// Run: node tests/life-campaign-sweep.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-life-sweep-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(`npx tsc src/lib/life-campaign/schedule.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { earlyEnrollmentFits } = require(join(out, 'schedule.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const today = '2026-10-02'

console.log('Sweep window agrees with the fit check')
for (const buffer of [0, 14, 30]) {
  t(`buffer ${buffer}: days_remaining = ${179 + buffer} fits, ${178 + buffer} does not`, () => {
    assert.equal(earlyEnrollmentFits(addDays(today, 179 + buffer), today, buffer), true)
    assert.equal(earlyEnrollmentFits(addDays(today, 178 + buffer), today, buffer), false)
  })
}
const tick = readFileSync('src/lib/life-campaign/tick.ts', 'utf8')
t('the sweep filters to the fitting window (179 + buffer) before ordering', () => {
  assert.match(tick, /const minDays = 179 \+ Number\(cfg\.early_enrollment_buffer_days \?\? 0\)/)
  assert.match(tick, /\.gte\('days_remaining', minDays\)\s*\n\s*\.order\('days_remaining'/)
})
t('policies already enrolled in any state are skipped', () => {
  assert.match(tick, /if \(alreadyEnrolled\.has\(cand\.policy_id as string\)\) continue/)
})
t('the advisor task is select-before-insert (one per policy, ever)', () => {
  const fn = tick.slice(tick.indexOf('export async function ensureInsufficientTimeTask'))
  assert.match(fn, /\.eq\('title', INSUFFICIENT_TIME_TASK\)/)
  assert.match(fn, /if \(error \|\| exists\) return/)
})
t('enroll.ts no longer inserts the task unconditionally', () => {
  const enroll = readFileSync('src/lib/life-campaign/enroll.ts', 'utf8')
  assert.doesNotMatch(enroll, /from\('work_tasks'\)\.insert/)
  assert.match(enroll, /ensureInsufficientTimeTask\(db, input\.policyId\)/)
})
console.log(`\nAll ${passed} assertions passed.`)
