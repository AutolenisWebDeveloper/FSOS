// Life Conversion Campaign — advisor-touch completion policy (pure). §5a makes advisor
// outreach a real customer touch; §9a requires a due window, reminder cadence, escalation,
// and a completion definition that requires a logged outreach ATTEMPT (not just marking done).
// The campaign does not stall on an incomplete advisor task (default option (b): proceed).
// Run: node tests/life-campaign-advisor.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-adv-'))
execSync(
  `npx tsc src/lib/life-campaign/advisor.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { advisorTouchState, campaignProceedsPastAdvisor } = require(join(out, 'advisor.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const base = {
  dueAt: '2026-07-31T15:00:00.000Z',
  now: '2026-07-31T09:00:00.000Z',
  attemptLogged: false,
  remindersSent: [],
  overdueEscalateHours: 72,
  reassignAfterHours: 120,
}

t('a logged outreach attempt fulfils the touch regardless of clock', () => {
  const r = advisorTouchState({ ...base, attemptLogged: true, now: '2026-08-10T00:00:00.000Z' })
  assert.equal(r.status, 'fulfilled')
})

t('before the due time the task is simply due', () => {
  assert.equal(advisorTouchState(base).status, 'due')
})

t('past due with no attempt is overdue', () => {
  const r = advisorTouchState({ ...base, now: '2026-08-01T00:00:00.000Z' })
  assert.equal(r.status, 'overdue')
})

t('past the escalation threshold it escalates', () => {
  const r = advisorTouchState({ ...base, now: '2026-08-04T00:00:00.000Z' }) // ~84h after due
  assert.equal(r.status, 'escalate')
})

t('past the reassignment threshold it reassigns', () => {
  const r = advisorTouchState({ ...base, now: '2026-08-06T00:00:00.000Z' }) // ~129h after due
  assert.equal(r.status, 'reassign')
})

t('proposes the next reminder time while overdue and un-escalated', () => {
  const r = advisorTouchState({ ...base, now: '2026-08-01T00:00:00.000Z' })
  assert.ok(r.nextReminderAt, 'expected a nextReminderAt')
})

t('default campaign behavior proceeds past an incomplete advisor task (option b)', () => {
  assert.equal(campaignProceedsPastAdvisor('proceed'), true)
  assert.equal(campaignProceedsPastAdvisor('hold'), false)
})

console.log(`\n✓ life-campaign advisor: ${passed} assertions passed`)
