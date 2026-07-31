// Cross-Sell Life Campaign — two-state-machine proof (spec §15 / § Operational Controls).
// Compiles the PURE transition tables (src/lib/cross-sell-life/states.ts) in isolation (no
// Supabase) and asserts the dispatch gate, the terminal/read-only Archived campaign state, a
// sample of valid + forbidden campaign moves, and the enrollment machine's touch-receiving /
// terminal / transition rules — the same rules the migration-085 CHECK constraints mirror.
// Run: node tests/cross-sell-life-states.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-xsell-states-'))
execSync(
  `npx tsc src/lib/cross-sell-life/states.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  CAMPAIGN_STATES,
  canTransition,
  canDispatch,
  controlTargetState,
  ENROLLMENT_STATES,
  enrollmentCanReceiveTouch,
  isTerminal,
  validateEnrollmentTransition,
} = require(join(out, 'states.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

console.log('Campaign dispatch gate (only Active may send)')

t('canDispatch is true ONLY for "active"', () => {
  assert.equal(canDispatch('active'), true)
  for (const s of CAMPAIGN_STATES) {
    if (s !== 'active') assert.equal(canDispatch(s), false, `${s} must not dispatch`)
  }
  assert.equal(canDispatch('nonsense'), false)
})

console.log('Campaign transitions')

t('archived is terminal — no outgoing transition to any campaign state', () => {
  for (const s of CAMPAIGN_STATES) {
    assert.equal(canTransition('archived', s), false, `archived → ${s} must be forbidden`)
  }
})

t('a sample of VALID campaign transitions is allowed', () => {
  assert.equal(canTransition('draft', 'active'), true)
  assert.equal(canTransition('draft', 'approval_pending'), true)
  assert.equal(canTransition('active', 'paused'), true)
  assert.equal(canTransition('active', 'emergency_stopped'), true)
  assert.equal(canTransition('paused', 'active'), true)
})

t('a sample of INVALID campaign transitions is rejected', () => {
  assert.equal(canTransition('active', 'draft'), false)
  assert.equal(canTransition('draft', 'disabled'), false)
  assert.equal(canTransition('disabled', 'paused'), false)
  assert.equal(canTransition('active', 'bogus'), false)
  assert.equal(canTransition('bogus', 'active'), false)
})

t('controlTargetState maps control actions to their target state', () => {
  assert.equal(controlTargetState('submit'), 'approval_pending')
  assert.equal(controlTargetState('enable'), 'active')
  assert.equal(controlTargetState('resume'), 'active')
  assert.equal(controlTargetState('pause'), 'paused')
  assert.equal(controlTargetState('disable'), 'disabled')
  assert.equal(controlTargetState('emergency_stop'), 'emergency_stopped')
  assert.equal(controlTargetState('archive'), 'archived')
})

console.log('Enrollment machine (§15)')

t('enrollmentCanReceiveTouch is true ONLY for "running"', () => {
  assert.equal(enrollmentCanReceiveTouch('running'), true)
  for (const s of ENROLLMENT_STATES) {
    if (s !== 'running') assert.equal(enrollmentCanReceiveTouch(s), false, `${s} must not receive a proactive touch`)
  }
})

t('isTerminal is true for the full terminal set and false for live/hold states', () => {
  const terminal = [
    'appointment_scheduled', 'quote_requested', 'application_started', 'policy_issued',
    'purchased_elsewhere', 'completed', 'suppressed', 'cancelled',
  ]
  for (const s of terminal) assert.equal(isTerminal(s), true, `${s} should be terminal`)
  for (const s of ['running', 'enrolled', 'failed', 'compliance_hold', 'waiting_for_advisor', 'paused_by_admin']) {
    assert.equal(isTerminal(s), false, `${s} should NOT be terminal`)
  }
})

t('validateEnrollmentTransition allows running → appointment_scheduled', () => {
  assert.equal(validateEnrollmentTransition('running', 'appointment_scheduled'), true)
})

t('validateEnrollmentTransition forbids completed → running (terminal has no outgoing edge)', () => {
  assert.equal(validateEnrollmentTransition('completed', 'running'), false)
})

t('a self-transition is idempotently allowed; unknown states are rejected', () => {
  assert.equal(validateEnrollmentTransition('running', 'running'), true)
  assert.equal(validateEnrollmentTransition('running', 'not_a_state'), false)
  assert.equal(validateEnrollmentTransition('not_a_state', 'running'), false)
})

console.log(`\nAll ${passed} assertions passed.`)
