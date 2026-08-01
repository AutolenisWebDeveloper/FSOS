// Increment 0 — fail-closed personalization, proven at the pure-core layer.
// The shared render engine (personalize.ts) classifies merge tokens into a cosmetic tier
// (safe neutral default, never blocks) and a BLOCKING tier (advisor/agency identity,
// unsubscribe/scheduling links, and the booking specifics). A blocking token that a caller
// leaves unresolved must HARD-BLOCK the send at the gate — never render empty or a raw
// {{token}}. This test compiles the real personalize.ts + gate.ts and proves both halves:
// (1) unresolvedBlockingTokens() detection, and (2) the gate's escalating `personalization`
// step wired off that detection.
// Run: node tests/comms-personalization.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-personalization-'))
execSync(
  `npx tsc src/lib/comms/personalize.ts src/lib/comms/gate.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { personalize, unresolvedBlockingTokens, BLOCKING_TOKENS } = require(join(out, 'comms/personalize.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A gate input that passes every OTHER step, so the personalization step is what we isolate.
const clean = {
  draft: 'Hi there',
  channel: 'email',
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

console.log('unresolvedBlockingTokens')
t('cosmetic tokens (first_name) never block and keep a safe default', () => {
  assert.deepEqual(unresolvedBlockingTokens('Hi {{first_name}}', {}), [])
  assert.equal(personalize('Hi {{first_name}}', {}), 'Hi there')
})
t('every advisor/agency identity + link + booking token is classified blocking', () => {
  for (const tok of [
    'fsa_name', 'agency_name', 'advisor_phone', 'advisor_email',
    'unsubscribe_url', 'scheduling_link',
    'appointment_time', 'meeting_details', 'reschedule_url', 'cancel_url',
  ]) {
    assert.ok(BLOCKING_TOKENS.has(tok), `${tok} must be a blocking-tier token`)
  }
})
t('a referenced-but-unresolved blocking token is flagged; a resolved one is not', () => {
  assert.deepEqual(unresolvedBlockingTokens('{{fsa_name}}', {}), ['fsa_name'])
  assert.deepEqual(unresolvedBlockingTokens('{{fsa_name}}', { fsa_name: 'Markist Athelus' }), [])
})
t('a blocking token not referenced in the body is not required', () => {
  assert.deepEqual(unresolvedBlockingTokens('Hi {{first_name}}', {}), [])
})

console.log('gate — personalization step')
t('resolved personalization (default) passes the gate', () => {
  const r = evaluateGate(clean)
  assert.equal(r.allowed, true)
})
t('unresolved personalization HARD-BLOCKS and ESCALATES', () => {
  const r = evaluateGate({ ...clean, personalizationResolved: false, personalizationReason: 'Unresolved required merge tokens: scheduling_link' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'personalization')
  assert.equal(r.escalate, true)
  assert.match(r.reason, /scheduling_link/)
})
t('omitting personalizationResolved is backward-compatible (treated resolved)', () => {
  assert.equal(evaluateGate(clean).allowed, true)
})

console.log(`\n✓ personalization fail-closed: ${passed} assertions passed`)
