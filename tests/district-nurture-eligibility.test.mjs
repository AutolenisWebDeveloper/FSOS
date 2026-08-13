// District Agent FS Nurture — pure eligibility gate. Isolated tsc-compile-then-require, mirroring
// the other campaigns' eligibility tests. src/lib/district-nurture/eligibility.ts is self-contained.
//
// Run: node tests/district-nurture-eligibility.test.mjs
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

const out = mkdtempSync(join(tmpdir(), 'fsos-dn-elig-'))
execSync(
  `npx tsc src/lib/district-nurture/eligibility.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const E = require(join(out, 'eligibility.js'))

// A fully-eligible district agent.
const base = {
  reachable: true,
  agencyStatus: 'producing',
  optedOut: false,
  inActiveConversation: false,
  priorEnrollmentActive: false,
  cooldownActive: false,
}

console.log('\ndistrict-nurture eligibility — gate')

t('a reachable, active, opted-in, unenrolled agent is eligible', () => {
  const r = E.evaluateNurtureEligibility(base)
  assert.equal(r.eligible, true)
  assert.deepEqual(r.reasons, [])
})

t('an opted-out agent is never eligible', () => {
  const r = E.evaluateNurtureEligibility({ ...base, optedOut: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('opted_out'))
})

t('a terminated agency is excluded', () => {
  const r = E.evaluateNurtureEligibility({ ...base, agencyStatus: 'terminated' })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('agency_terminated'))
})

t('an unreachable agent (no email/phone) is excluded', () => {
  const r = E.evaluateNurtureEligibility({ ...base, reachable: false })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('not_reachable'))
})

t('a live conversation blocks (pause), a duplicate enrollment blocks, cooldown blocks', () => {
  assert.ok(E.evaluateNurtureEligibility({ ...base, inActiveConversation: true }).reasons.includes('in_conversation'))
  assert.ok(E.evaluateNurtureEligibility({ ...base, priorEnrollmentActive: true }).reasons.includes('duplicate_active'))
  assert.ok(E.evaluateNurtureEligibility({ ...base, cooldownActive: true }).reasons.includes('in_cooldown'))
})

console.log('\ndistrict-nurture eligibility — override + recheck classification')

t('cooldown is the only manually-overridable reason', () => {
  assert.deepEqual([...E.OVERRIDABLE_REASONS], ['in_cooldown'])
})

t('recheck: opt-out → suppressed, conversation → paused, terminal → exited', () => {
  assert.equal(E.classifyRecheckOutcome(['opted_out']), 'suppressed')
  assert.equal(E.classifyRecheckOutcome(['in_conversation']), 'paused_for_conversation')
  assert.equal(E.classifyRecheckOutcome(['agency_terminated']), 'exited')
  assert.equal(E.classifyRecheckOutcome(['no_longer_eligible']), 'exited')
})

t('recheck: a conversation alongside a terminal reason exits (does not merely pause)', () => {
  assert.equal(E.classifyRecheckOutcome(['in_conversation', 'agency_terminated']), 'exited')
})

console.log(`\n✓ district-nurture-eligibility: ${passed} assertions passed`)
