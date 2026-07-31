// Life Conversion Campaign — operational + enrollment state machines (pure). Proves the
// §4b 7-state campaign lifecycle (only Active dispatches; Archived terminal; Emergency
// Stopped re-enable is deliberate) and the enrollment lifecycle that distinguishes a
// reply-pause from an admin/global pause (§4b resume options depend on that distinction).
// Run: node tests/life-campaign-states.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-states-'))
execSync(
  `npx tsc src/lib/life-campaign/states.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const m = require(join(out, 'states.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('campaign lifecycle — §4b')

t('exposes all seven campaign states', () => {
  assert.deepEqual(
    [...m.CAMPAIGN_STATES].sort(),
    ['active', 'approval_pending', 'archived', 'disabled', 'draft', 'emergency_stopped', 'paused'].sort(),
  )
})

t('only Active may dispatch', () => {
  assert.equal(m.canDispatch('active'), true)
  for (const s of m.CAMPAIGN_STATES) if (s !== 'active') assert.equal(m.canDispatch(s), false)
})

t('Archived is terminal — no outgoing transitions', () => {
  for (const s of m.CAMPAIGN_STATES) assert.equal(m.canTransition('archived', s), false)
})

t('Emergency Stopped → Active is allowed (deliberate re-enable)', () => {
  assert.equal(m.canTransition('emergency_stopped', 'active'), true)
})

t('Paused → Active is a routine resume; Draft cannot jump straight to Active', () => {
  assert.equal(m.canTransition('paused', 'active'), true)
  assert.equal(m.canTransition('draft', 'active'), false) // must pass approval first
  assert.equal(m.canTransition('approval_pending', 'active'), true)
})

t('maps a control action to its target state', () => {
  assert.equal(m.controlTargetState('emergency_stop'), 'emergency_stopped')
  assert.equal(m.controlTargetState('archive'), 'archived')
  assert.equal(m.controlTargetState('enable'), 'active')
  assert.equal(m.controlTargetState('disable'), 'disabled')
})

console.log('enrollment lifecycle — §13 / §4b')

t('exposes the enrollment states incl. distinct reply-pause vs admin-pause', () => {
  for (const s of ['active', 'paused_for_conversation', 'paused_by_admin', 'completed', 'exited', 'suppressed']) {
    assert.ok(m.ENROLLMENT_STATES.includes(s), `missing ${s}`)
  }
})

t('a touch fires only from an active enrollment', () => {
  assert.equal(m.enrollmentCanReceiveTouch('active'), true)
  for (const s of ['paused_for_conversation', 'paused_by_admin', 'completed', 'exited', 'suppressed']) {
    assert.equal(m.enrollmentCanReceiveTouch(s), false)
  }
})

console.log(`\n✓ life-campaign states: ${passed} assertions passed`)
