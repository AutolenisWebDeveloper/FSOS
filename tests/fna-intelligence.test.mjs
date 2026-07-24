// FNA planning-intelligence proof (Slice 10). Compiles the PURE signal aggregation
// standalone and asserts the derived dashboard signals. Offline.
// Run: node tests/fna-intelligence.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-intel-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
execSync(`npx tsc src/lib/fna/intelligence.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { computePlanningSignals } = require(join(out, 'intelligence.js'))

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

check('aggregates status counts, completeness, and milestones', () => {
  const s = computePlanningSignals({
    plans: [
      { status: 'APPROVED', completeness: 1 },
      { status: 'CALCULATED', completeness: 0.4 },
      { status: 'UNDER_REVIEW', completeness: 0.8 },
      { status: 'DRAFT', completeness: null },
    ],
    openDataQuality: 3,
    draftRecommendations: 2,
    reviewsDue: 4,
    policyMilestones: 5,
  })
  assert.equal(s.plansTotal, 4)
  assert.equal(s.approved, 1)
  assert.equal(s.needsAttention, 2) // CALCULATED + UNDER_REVIEW
  assert.equal(s.lowCompleteness, 1) // the 0.4 plan
  assert.ok(Math.abs(s.planningConfidence - (1 + 0.4 + 0.8) / 3) < 1e-9) // only calculated plans
  assert.equal(s.openDataQuality, 3)
  assert.equal(s.openAdvisorActions, 2)
  assert.equal(s.reviewsDue, 4)
  assert.equal(s.upcomingMilestones, 9) // reviews + policies
})

check('empty input is safe (no NaN)', () => {
  const s = computePlanningSignals({ plans: [], openDataQuality: 0, draftRecommendations: 0, reviewsDue: 0, policyMilestones: 0 })
  assert.equal(s.plansTotal, 0)
  assert.equal(s.planningConfidence, 0)
  assert.equal(s.upcomingMilestones, 0)
})

const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA planning-intelligence proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
