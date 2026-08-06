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

// ── UNREGISTERED tokens fail CLOSED, not SILENT ────────────────────────────────────────
// Regression: an unregistered token (a typo, or one a caller forgets to supply) is rendered as
// an empty string by personalize() exactly like a blocking token — but it used to `continue` out
// of unresolvedBlockingTokens() entirely, so the gate never saw it and the send shipped with a
// blank where a fact belonged. Found in review as {{appointment_date}} in a win-back reminder:
// "your meeting with X on  at Thursday, August 14...". Blocking failed safe; unknown failed silent.
console.log('\nunregistered tokens')
t('an unregistered token is REPORTED when nothing resolves it', () => {
  assert.deepEqual(unresolvedBlockingTokens('Meeting on {{appointment_date}}', {}), ['appointment_date'])
  assert.equal(BLOCKING_TOKENS.has('appointment_date'), false, 'guard: token must be unregistered for this test to mean anything')
})
t('an unregistered token still renders EMPTY (never a raw {{token}}) — the gate is what stops it', () => {
  assert.equal(personalize('Meeting on {{appointment_date}}', {}), 'Meeting on ')
})
t('an unregistered token a caller DOES supply resolves and never blocks', () => {
  // The RecipientContext index signature is documented extensibility — supplying a custom
  // green-zone token must keep working, so only tokens resolving to nothing are reported.
  assert.deepEqual(unresolvedBlockingTokens('Meeting on {{appointment_date}}', { appointment_date: 'Aug 14' }), [])
  assert.equal(personalize('Meeting on {{appointment_date}}', { appointment_date: 'Aug 14' }), 'Meeting on Aug 14')
})
t('an unregistered token wired to the gate HARD-BLOCKS and escalates', () => {
  const body = 'Meeting on {{appointment_date}}'
  const unresolved = unresolvedBlockingTokens(body, {})
  const r = evaluateGate({
    ...clean,
    personalizationResolved: unresolved.length === 0,
    personalizationReason: `Unresolved required merge tokens: ${unresolved.join(', ')}`,
  })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'personalization')
  assert.equal(r.escalate, true)
  assert.match(r.reason, /appointment_date/)
})
t('cosmetic tokens are still exempt after the change (no over-blocking)', () => {
  assert.deepEqual(unresolvedBlockingTokens('Hi {{first_name}}, welcome to {{city}}', {}), [])
})

console.log(`\n✓ personalization fail-closed: ${passed} assertions passed`)
