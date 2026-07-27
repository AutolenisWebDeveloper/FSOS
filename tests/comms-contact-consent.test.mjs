// A2P 10DLC / TCPA — durable public-intake SMS consent (migration 074). Proves the PURE
// decider + normalization offline, and that a granted/absent contact-consent drives the
// gate's step-1 consent decision (the enforcement read wired in src/lib/comms/send.ts).
// No DB, no server. Run: node tests/comms-contact-consent.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-contact-consent-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/comms/contact-consent.ts src/lib/comms/gate.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { latestConsentGranted, consentContactKey, smsTail } = require(join(out, 'comms/contact-consent.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('latestConsentGranted (latest-wins, fail-closed)')

t('NO rows ⇒ not granted (fail-closed, no positive consent)', () => {
  assert.equal(latestConsentGranted([]), false)
  assert.equal(latestConsentGranted(null), false)
  assert.equal(latestConsentGranted(undefined), false)
})

t('a single granted row ⇒ granted', () => {
  assert.equal(latestConsentGranted([{ action: 'granted', captured_at: '2026-07-27T10:00:00Z' }]), true)
})

t('a later REVOKED overrides an earlier granted', () => {
  assert.equal(
    latestConsentGranted([
      { action: 'granted', captured_at: '2026-07-27T10:00:00Z' },
      { action: 'revoked', captured_at: '2026-07-27T12:00:00Z' },
    ]),
    false,
  )
})

t('a later GRANTED (re-consent) overrides an earlier revoke', () => {
  assert.equal(
    latestConsentGranted([
      { action: 'revoked', captured_at: '2026-07-27T12:00:00Z' },
      { action: 'granted', captured_at: '2026-07-27T13:00:00Z' },
    ]),
    true,
  )
})

t('an unparseable timestamp never outranks a real dated decision', () => {
  assert.equal(
    latestConsentGranted([
      { action: 'granted', captured_at: '2026-07-27T10:00:00Z' },
      { action: 'revoked', captured_at: 'not-a-date' },
    ]),
    true,
  )
})

console.log('contact normalization (storage/resolution keys)')

t('sms key strips formatting; email key lower-cases', () => {
  assert.equal(consentContactKey('sms', '(972) 555-0134'), '9725550134')
  assert.equal(consentContactKey('sms', '+1 972-555-0134'), '+19725550134')
  assert.equal(consentContactKey('email', '  Person@Example.COM '), 'person@example.com')
})

t('smsTail returns the last 10 digits (tolerant of +1/bare drift)', () => {
  assert.equal(smsTail('+1 (972) 555-0134'), '9725550134')
  assert.equal(smsTail('9725550134'), '9725550134')
})

console.log('gate step-1 consent is driven by the resolved contact-consent')

// Clean gate context (all other steps pass) so ONLY the consent bit matters.
const base = {
  draft: 'A friendly note inviting you to reconnect.',
  channel: 'sms',
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

t('a GRANTED public-intake consent lets the send pass the consent step', () => {
  const granted = latestConsentGranted([{ action: 'granted', captured_at: '2026-07-27T10:00:00Z' }])
  const r = evaluateGate({ ...base, hasConsent: granted })
  assert.equal(r.allowed, true)
})

t('NO public-intake consent blocks + escalates at the consent step', () => {
  const granted = latestConsentGranted([]) // fail-closed
  const r = evaluateGate({ ...base, hasConsent: granted })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'consent')
  assert.equal(r.escalate, true)
})

console.log(`\n${passed} contact-consent assertions passed.\n`)
