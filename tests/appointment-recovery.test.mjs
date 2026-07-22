// Appointment lifecycle + no-show recovery gate — proves the PURE core
// (lib/appointments/recovery.ts): the status state-machine only allows valid
// transitions, overdue detection flags scheduled-but-past appointments for triage, the
// appointment funnel computes an honest show-rate, and no-show recovery plans exactly
// one recovery task per un-recovered no-show (deduped). Compiles the pure module in
// isolation (no Supabase). Run: node tests/appointment-recovery.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-appt-'))
execSync(
  `npx tsc src/lib/appointments/recovery.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  APPOINTMENT_STATUSES,
  canTransition,
  isOverdue,
  needsRecovery,
  appointmentFunnel,
  planNoShowRecovery,
} = require(join(out, 'recovery.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

function appt(over = {}) {
  return {
    id: 'a-' + Math.random().toString(36).slice(2),
    household_id: 'hh',
    opportunity_id: null,
    scheduled_at: '2026-07-20T15:00:00Z',
    status: 'scheduled',
    ...over,
  }
}

const NOW = new Date('2026-07-22T00:00:00Z')

console.log('Status state machine (canTransition)')

t('scheduled can become completed / cancelled / no_show', () => {
  assert.equal(canTransition('scheduled', 'completed'), true)
  assert.equal(canTransition('scheduled', 'cancelled'), true)
  assert.equal(canTransition('scheduled', 'no_show'), true)
})

t('a no_show or cancelled appointment can be rescheduled back to scheduled', () => {
  assert.equal(canTransition('no_show', 'scheduled'), true)
  assert.equal(canTransition('cancelled', 'scheduled'), true)
})

t('completed is terminal, and a no-op same-state is not a transition', () => {
  assert.equal(canTransition('completed', 'scheduled'), false)
  assert.equal(canTransition('completed', 'no_show'), false)
  assert.equal(canTransition('scheduled', 'scheduled'), false)
})

t('an unknown status never transitions', () => {
  assert.equal(canTransition('bogus', 'completed'), false)
  assert.equal(canTransition('scheduled', 'bogus'), false)
})

console.log('Overdue detection (isOverdue)')

t('a scheduled appointment in the past is overdue (needs a completed/no_show decision)', () => {
  assert.equal(isOverdue(appt({ status: 'scheduled', scheduled_at: '2026-07-20T15:00:00Z' }), NOW), true)
})

t('a future scheduled appointment is not overdue', () => {
  assert.equal(isOverdue(appt({ status: 'scheduled', scheduled_at: '2026-07-25T15:00:00Z' }), NOW), false)
})

t('a past appointment that is already completed / no_show is not "overdue"', () => {
  assert.equal(isOverdue(appt({ status: 'completed', scheduled_at: '2026-07-20T15:00:00Z' }), NOW), false)
  assert.equal(isOverdue(appt({ status: 'no_show', scheduled_at: '2026-07-20T15:00:00Z' }), NOW), false)
})

console.log('Recovery predicate + funnel')

t('needsRecovery is true only for no_show', () => {
  assert.equal(needsRecovery(appt({ status: 'no_show' })), true)
  assert.equal(needsRecovery(appt({ status: 'completed' })), false)
  assert.equal(needsRecovery(appt({ status: 'scheduled' })), false)
})

t('the funnel counts by status and computes an honest show-rate', () => {
  const f = appointmentFunnel([
    appt({ status: 'scheduled' }),
    appt({ status: 'completed' }),
    appt({ status: 'completed' }),
    appt({ status: 'completed' }),
    appt({ status: 'no_show' }),
    appt({ status: 'cancelled' }),
  ])
  assert.equal(f.scheduled, 1)
  assert.equal(f.completed, 3)
  assert.equal(f.noShow, 1)
  assert.equal(f.cancelled, 1)
  assert.equal(f.total, 6)
  // show-rate = completed / (completed + no_show) = 3/4 = 75
  assert.equal(f.showRate, 75)
})

t('show-rate is 0 when there are no held (completed+no_show) appointments', () => {
  const f = appointmentFunnel([appt({ status: 'scheduled' }), appt({ status: 'cancelled' })])
  assert.equal(f.showRate, 0)
})

console.log('No-show recovery planning (planNoShowRecovery) — one task per un-recovered no-show')

t('plans exactly one recovery draft per no_show, skipping already-recovered ones', () => {
  const a1 = appt({ id: 'a1', status: 'no_show', household_id: 'h1', opportunity_id: 'o1' })
  const a2 = appt({ id: 'a2', status: 'no_show', household_id: 'h2' })
  const a3 = appt({ id: 'a3', status: 'completed' })
  const { drafts, skipped } = planNoShowRecovery([a1, a2, a3], ['a2'])
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].appointment_id, 'a1')
  assert.equal(drafts[0].household_id, 'h1')
  assert.equal(drafts[0].opportunity_id, 'o1')
  // a2 already has a recovery task; a3 is not a no-show
  assert.ok(skipped.some((s) => s.appointment_id === 'a2' && s.reason === 'already_recovered'))
})

t('two no_show rows for the same appointment id only plan once (batch dedup)', () => {
  const a = appt({ id: 'dup', status: 'no_show' })
  const { drafts } = planNoShowRecovery([a, { ...a }], [])
  assert.equal(drafts.length, 1)
})

t('a recovery draft carries a green-zone reschedule reason, never a recommendation', () => {
  const { drafts } = planNoShowRecovery([appt({ id: 'x', status: 'no_show' })], [])
  assert.match(drafts[0].reason, /resched|follow|missed|no-show/i)
  assert.doesNotMatch(drafts[0].reason, /recommend|you should|buy|purchase/i)
})

t('APPOINTMENT_STATUSES matches the appointments table enum', () => {
  assert.deepEqual([...APPOINTMENT_STATUSES], ['scheduled', 'completed', 'cancelled', 'no_show'])
})

console.log(`\nAll ${passed} assertions passed.`)
