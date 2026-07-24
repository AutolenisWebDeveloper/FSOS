// Slice 6 (§13) — Data confidence & source verification. Proves the pure decision +
// the data_confidence gate step offline. Run: node tests/comms-data-confidence.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-dataconf-'))
execSync(
  `npx tsc src/lib/comms/data-confidence.ts src/lib/comms/gate.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateDataConfidence } = require(join(out, 'comms/data-confidence.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('evaluateDataConfidence (§13)')

t('a message with NO specific claims always passes (generic invitation)', () => {
  const r = evaluateDataConfidence({ makesSpecificClaims: false, claims: [{ key: 'policy.conversion_deadline', verified: false }] })
  assert.equal(r.allowed, true)
  assert.deepEqual(r.unverified, [])
})

t('a specific claim on a VERIFIED field passes', () => {
  const r = evaluateDataConfidence({ makesSpecificClaims: true, claims: [{ key: 'policy.conversion_deadline', verified: true }] })
  assert.equal(r.allowed, true)
})

t('a specific claim on an UNVERIFIED field is EXCLUDED + lists the field', () => {
  const r = evaluateDataConfidence({ makesSpecificClaims: true, claims: [{ key: 'policy.conversion_deadline', verified: false }] })
  assert.equal(r.allowed, false)
  assert.deepEqual(r.unverified, ['policy.conversion_deadline'])
  assert.match(r.reason, /verification task/i)
})

t('a CONFLICTING field is insufficient even if flagged verified', () => {
  const r = evaluateDataConfidence({ makesSpecificClaims: true, claims: [{ key: 'policy_record', verified: true, conflicting: true }] })
  assert.equal(r.allowed, false)
  assert.ok(r.unverified.includes('policy_record'))
})

t('an unverified field ABOVE the confidence threshold is sufficient; below is not', () => {
  assert.equal(evaluateDataConfidence({ makesSpecificClaims: true, minConfidence: 0.8, claims: [{ key: 'age', verified: false, confidence: 0.9 }] }).allowed, true)
  assert.equal(evaluateDataConfidence({ makesSpecificClaims: true, minConfidence: 0.8, claims: [{ key: 'age', verified: false, confidence: 0.6 }] }).allowed, false)
})

t('collects EVERY insufficient field (not just the first)', () => {
  const r = evaluateDataConfidence({
    makesSpecificClaims: true,
    claims: [
      { key: 'conversion_deadline', verified: false },
      { key: 'product_ownership', verified: false },
      { key: 'lapse_status', verified: true },
    ],
  })
  assert.deepEqual(r.unverified.sort(), ['conversion_deadline', 'product_ownership'])
})

console.log('Gate step — data_confidence (§13; escalates → verification task)')

const okCtx = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }

t('BACKWARD-COMPAT: no data-confidence input still passes', () => {
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx }).allowed, true)
})

t('dataConfidenceOk=false HARD-blocks + ESCALATES (verification task)', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, dataConfidenceOk: false, dataConfidenceReason: 'unverified conversion deadline' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'data_confidence')
  assert.equal(r.escalate, true)
  assert.match(r.reason, /unverified/)
})

t('compliance blocks still precede data_confidence; data_confidence precedes operational deferrals', () => {
  // securities (earlier) wins over a data-confidence failure.
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, isSecurity: true, dataConfidenceOk: false }).blockedStep, 'is_security')
  // data_confidence (escalating) wins over a frequency deferral (operational, later).
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, dataConfidenceOk: false, withinFrequencyCaps: false })
  assert.equal(r.blockedStep, 'data_confidence')
  assert.equal(r.escalate, true)
})

console.log(`\nAll ${passed} data-confidence assertions passed.`)
