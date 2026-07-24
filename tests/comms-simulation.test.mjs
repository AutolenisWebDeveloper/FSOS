// Slice 6 (§14) — Simulation mode. Proves the pure report core + the
// simulation-required-before-activation gate offline. Run: node tests/comms-simulation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-sim-'))
execSync(
  `npx tsc src/lib/comms/simulation-core.ts src/lib/comms/gate.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { verdictFromGate, summarizeSimulation, simulationSatisfiesActivation } = require(join(out, 'comms/simulation-core.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

const okCtx = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }

console.log('verdictFromGate — reuses the real gate (never sends)')

t('a passing gate → wouldSend, no exclusion reason', () => {
  const v = verdictFromGate(evaluateGate({ draft: 'Reminder: your review is tomorrow.', channel: 'sms', ...okCtx }))
  assert.equal(v.wouldSend, true)
  assert.equal(v.excludedReason, null)
})

t('a blocked gate → excluded with the EXACT reason (step + text)', () => {
  const v = verdictFromGate(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, hasConsent: false }))
  assert.equal(v.wouldSend, false)
  assert.match(v.excludedReason, /^consent:/)
})

console.log('summarizeSimulation — pre-activation preview counts')

t('counts would-send vs excluded and buckets exclusions by step', () => {
  const entries = [
    { wouldSend: true, excludedReason: null },
    { wouldSend: false, excludedReason: 'consent: No valid channel consent on file.' },
    { wouldSend: false, excludedReason: 'consent: No valid channel consent on file.' },
    { wouldSend: false, excludedReason: 'dnc: Recipient is on the do-not-contact list.' },
  ]
  const s = summarizeSimulation(entries)
  assert.equal(s.audience, 4)
  assert.equal(s.wouldSend, 1)
  assert.equal(s.excluded, 3)
  assert.equal(s.excludedByStep.consent, 2)
  assert.equal(s.excludedByStep.dnc, 1)
})

console.log('simulationSatisfiesActivation — §14 required-before-activation')

const NOW = '2026-07-24T12:00:00Z'

t('no simulation on record BLOCKS activation', () => {
  const r = simulationSatisfiesActivation(null, NOW)
  assert.equal(r.ok, false)
  assert.match(r.reason, /required before activation/i)
})

t('a recent simulation SATISFIES activation', () => {
  const r = simulationSatisfiesActivation('2026-07-24T06:00:00Z', NOW) // 6h old
  assert.equal(r.ok, true)
})

t('a stale simulation (older than the freshness window) BLOCKS activation', () => {
  const r = simulationSatisfiesActivation('2026-07-22T12:00:00Z', NOW) // 48h old
  assert.equal(r.ok, false)
  assert.match(r.reason, /older than/i)
})

t('a future/invalid simulation timestamp BLOCKS activation', () => {
  const r = simulationSatisfiesActivation('2026-07-25T12:00:00Z', NOW)
  assert.equal(r.ok, false)
})

console.log(`\nAll ${passed} simulation assertions passed.`)
