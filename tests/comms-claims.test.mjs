// Slice 8 (§18) — Data-confidence claim wiring. Proves the PURE core offline: mapping a
// campaign's declared claim fields + their resolved verification state → the data-confidence
// input the gate consumes (§13). A campaign with no declared claims makes no specific claim
// and is unaffected. No DB, no clock. Run: node tests/comms-claims.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-claims-'))
execSync(
  `npx tsc src/lib/comms/claims.ts src/lib/comms/data-confidence.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { CLAIM_FIELD_KEYS, campaignClaimKeys, buildDataConfidence } = require(join(out, 'claims.js'))
const { evaluateDataConfidence } = require(join(out, 'data-confidence.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('campaignClaimKeys — validate the stored declaration')

t('known keys are kept; unknown/empty are dropped; null → []', () => {
  assert.deepEqual(campaignClaimKeys(['conversion_deadline', 'bogus', 'appointment_at']), ['conversion_deadline', 'appointment_at'])
  assert.deepEqual(campaignClaimKeys(null), [])
  assert.deepEqual(campaignClaimKeys(undefined), [])
  assert.deepEqual(campaignClaimKeys([]), [])
})

t('CLAIM_FIELD_KEYS covers the claim-bearing blueprint fields', () => {
  for (const k of ['conversion_deadline', 'policy_status', 'appointment_at']) {
    assert.ok(CLAIM_FIELD_KEYS.includes(k), k)
  }
})

console.log('buildDataConfidence — declared claims → gate input')

t('no declared claims → makesSpecificClaims=false (a generic send is never blocked)', () => {
  const dc = buildDataConfidence([])
  assert.equal(dc.makesSpecificClaims, false)
  assert.equal(evaluateDataConfidence(dc).allowed, true)
})

t('all declared fields verified → passes data confidence', () => {
  const resolved = [
    { key: 'conversion_deadline', verified: true },
    { key: 'appointment_at', verified: true },
  ]
  const dc = buildDataConfidence(resolved)
  assert.equal(dc.makesSpecificClaims, true)
  assert.equal(evaluateDataConfidence(dc).allowed, true)
})

t('an unverified declared field → excluded, and it is reported for the verification task', () => {
  const resolved = [
    { key: 'conversion_deadline', verified: false },
    { key: 'appointment_at', verified: true },
  ]
  const decision = evaluateDataConfidence(buildDataConfidence(resolved))
  assert.equal(decision.allowed, false)
  assert.ok(decision.unverified.includes('conversion_deadline'))
})

t('a conflicting declared field → excluded (never send on conflicting records)', () => {
  const resolved = [{ key: 'policy_status', verified: true, conflicting: true }]
  assert.equal(evaluateDataConfidence(buildDataConfidence(resolved)).allowed, false)
})

t('a low-confidence unverified field → excluded; above threshold → allowed', () => {
  assert.equal(evaluateDataConfidence(buildDataConfidence([{ key: 'conversion_deadline', verified: false, confidence: 0.5 }])).allowed, false)
  assert.equal(evaluateDataConfidence(buildDataConfidence([{ key: 'conversion_deadline', verified: false, confidence: 0.95 }])).allowed, true)
})

console.log(`\n${passed} assertions passed.`)
