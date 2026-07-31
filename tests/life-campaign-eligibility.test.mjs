// Life Conversion Campaign — eligibility engine (pure). Encodes the owner-approved
// Active Opportunity Ownership rule (Checkpoint 1) + §4/§4a/§12 suppression, dedupe,
// cooldown, and the securities firewall. Eligibility is recomputed before enrollment AND
// before every scheduled touch, so this is the single gate both call.
// Run: node tests/life-campaign-eligibility.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-elig-'))
execSync(
  `npx tsc src/lib/life-campaign/eligibility.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateEligibility } = require(join(out, 'eligibility.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const base = {
  isSecurity: false,
  openOpportunities: [],
  priorEnrollmentActive: false,
  optedOut: false,
  lastTerminalAt: null,
  cooldownDays: 30,
  now: '2026-07-31',
  conversionDeadline: '2027-06-01',
}

t('a clean contact with a verified future deadline is eligible', () => {
  const r = evaluateEligibility(base)
  assert.equal(r.eligible, true)
  assert.deepEqual(r.reasons, [])
})

t('a securities-flagged policy is excluded (firewall) above all else', () => {
  const r = evaluateEligibility({ ...base, isSecurity: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('securities_excluded'))
})

t('an OPEN term_conversion opportunity makes the contact ineligible (Active Opportunity Ownership)', () => {
  const r = evaluateEligibility({ ...base, openOpportunities: [{ stage: 'application' }] })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('active_opportunity'))
})

t('a Closed Won opportunity is a permanent exclusion', () => {
  const r = evaluateEligibility({ ...base, openOpportunities: [{ stage: 'placed_issued' }] })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('closed_won'))
})

t('a Closed Lost opportunity within the cooldown window blocks re-enrollment', () => {
  const r = evaluateEligibility({ ...base, openOpportunities: [{ stage: 'lost' }], lastTerminalAt: '2026-07-20' })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('cooldown'))
})

t('a Closed Lost opportunity past the cooldown window is eligible again', () => {
  const r = evaluateEligibility({ ...base, openOpportunities: [{ stage: 'lost' }], lastTerminalAt: '2026-05-01' })
  assert.equal(r.eligible, true)
})

t('an opted-out contact is never eligible', () => {
  const r = evaluateEligibility({ ...base, optedOut: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('opted_out'))
})

t('an already-active enrollment is a duplicate (idempotent enrollment guard)', () => {
  const r = evaluateEligibility({ ...base, priorEnrollmentActive: true })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('duplicate_active'))
})

t('no verified deadline → not eligible (never manufacture urgency, §4.3/§12)', () => {
  const r = evaluateEligibility({ ...base, conversionDeadline: null })
  assert.equal(r.eligible, false)
  assert.ok(r.reasons.includes('no_verified_deadline'))
})

console.log(`\n✓ life-campaign eligibility: ${passed} assertions passed`)
