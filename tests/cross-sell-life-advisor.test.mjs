// Cross-Sell Life Campaign — advisor-outreach completion policy proof (spec §10). Compiles the
// PURE policy (src/lib/cross-sell-life/advisor.ts) in isolation (no Supabase/clock) and asserts the
// completion definition (a LOGGED attempt fulfils the touch and wins over any clock state), the
// due/overdue/escalate/reassign ladder, and the timeline-advance behavior for an incomplete task.
// Run: node tests/cross-sell-life-advisor.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-advisor-'))
execSync(
  `npx tsc src/lib/cross-sell-life/advisor.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { advisorTouchState, campaignProceedsPastAdvisor } = require(join(out, 'advisor.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const DUE = '2026-07-31T10:00:00Z'
// hoursFromDue → an ISO instant that many hours after the due time.
const at = (hours) => new Date(Date.parse(DUE) + hours * 3600000).toISOString()

function input(over = {}) {
  return {
    dueAt: DUE,
    now: DUE,
    attemptLogged: false,
    remindersSent: [],
    overdueEscalateHours: 24,
    reassignAfterHours: 72,
    ...over,
  }
}

console.log('Completion definition (a logged attempt fulfils the touch)')

t('a logged attempt → "fulfilled", even long past the reassign horizon', () => {
  const s = advisorTouchState(input({ attemptLogged: true, now: at(1000) }))
  assert.equal(s.status, 'fulfilled')
  assert.equal(s.nextReminderAt, null)
})

console.log('Due/overdue ladder (no attempt logged)')

t('not yet due (now before dueAt) → "due"', () => {
  const s = advisorTouchState(input({ now: at(-1) }))
  assert.equal(s.status, 'due')
})

t('past reassignAfterHours → "reassign"', () => {
  const s = advisorTouchState(input({ now: at(80) })) // >= 72h
  assert.equal(s.status, 'reassign')
})

t('between escalate and reassign → "escalate"', () => {
  const s = advisorTouchState(input({ now: at(30) })) // 24h <= 30h < 72h
  assert.equal(s.status, 'escalate')
})

t('past due but before the escalate horizon → "overdue"', () => {
  const s = advisorTouchState(input({ now: at(5) })) // 0 <= 5h < 24h
  assert.equal(s.status, 'overdue')
})

t('boundary: exactly at escalate horizon → "escalate"; exactly at reassign → "reassign"', () => {
  assert.equal(advisorTouchState(input({ now: at(24) })).status, 'escalate')
  assert.equal(advisorTouchState(input({ now: at(72) })).status, 'reassign')
})

console.log('Timeline advance for an incomplete task (§10 default "proceed")')

t('campaignProceedsPastAdvisor: proceed → true, hold → false', () => {
  assert.equal(campaignProceedsPastAdvisor('proceed'), true)
  assert.equal(campaignProceedsPastAdvisor('hold'), false)
})

console.log(`\nAll ${passed} assertions passed.`)
