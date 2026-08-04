// Email stream separation — the PURE From-address resolver (reputation isolation:
// transactional notify. vs marketing mail.). Proves config-driven resolution and the
// non-breaking fallback offline: no DB, no network, no Resend.
//
// Architecture note: this resolves the envelope From only — it does NOT introduce a
// parallel send path. The app's one Resend choke-point (lib/messaging.sendEmail) and
// the one gated dispatcher path are unchanged; they call resolveSender() for the From.
//
// Run: node tests/comms-email-senders.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-senders-'))
// senders.ts imports only ./purpose (also pure) — compile both standalone.
execSync(
  `npx tsc src/lib/comms/senders.ts src/lib/comms/purpose.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { resolveSender, streamForPurpose, emailDomainOf } = require(join(out, 'lib/comms/senders.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// Clean slate for the env this module reads.
const KEYS = ['RESEND_FROM_EMAIL', 'EMAIL_MARKETING_FROM', 'EMAIL_TRANSACTIONAL_FROM', 'EMAIL_MARKETING_REPLY_TO', 'EMAIL_TRANSACTIONAL_REPLY_TO']
const clearEnv = () => { for (const k of KEYS) delete process.env[k] }

console.log('senders — non-breaking fallback (opt-in)')

t('unset stream env → BOTH streams fall back to RESEND_FROM_EMAIL (today\'s behavior)', () => {
  clearEnv()
  process.env.RESEND_FROM_EMAIL = 'Markist <hello@markistfsa.com>'
  assert.equal(resolveSender('marketing').from, 'Markist <hello@markistfsa.com>')
  assert.equal(resolveSender('transactional').from, 'Markist <hello@markistfsa.com>')
})

t('streams fall back INDEPENDENTLY — configuring only transactional does not move marketing onto it', () => {
  clearEnv()
  process.env.RESEND_FROM_EMAIL = 'Markist <hello@markistfsa.com>'
  process.env.EMAIL_TRANSACTIONAL_FROM = 'Markist <notify@notify.markistfsa.com>'
  assert.equal(resolveSender('transactional').from, 'Markist <notify@notify.markistfsa.com>')
  // marketing must NOT land on the transactional subdomain — stays on the legacy default.
  assert.equal(resolveSender('marketing').from, 'Markist <hello@markistfsa.com>')
})

t('both streams configured → each uses its own verified subdomain', () => {
  clearEnv()
  process.env.RESEND_FROM_EMAIL = 'Markist <hello@markistfsa.com>'
  process.env.EMAIL_TRANSACTIONAL_FROM = 'Markist <notify@notify.markistfsa.com>'
  process.env.EMAIL_MARKETING_FROM = 'Markist <markist@mail.markistfsa.com>'
  assert.equal(resolveSender('transactional').sendingDomain, 'notify.markistfsa.com')
  assert.equal(resolveSender('marketing').sendingDomain, 'mail.markistfsa.com')
  assert.notEqual(resolveSender('transactional').from, resolveSender('marketing').from)
})

t('per-stream reply-to override is surfaced only when set', () => {
  clearEnv()
  process.env.RESEND_FROM_EMAIL = 'Markist <hello@markistfsa.com>'
  assert.equal(resolveSender('transactional').replyTo, undefined)
  process.env.EMAIL_TRANSACTIONAL_REPLY_TO = 'markist@markistfsa.com'
  assert.equal(resolveSender('transactional').replyTo, 'markist@markistfsa.com')
})

console.log('senders — purpose → stream (reuses the existing taxonomy)')

t('marketing/workshop → marketing; servicing/appointment/transactional → transactional', () => {
  assert.equal(streamForPurpose('MARKETING'), 'marketing')
  assert.equal(streamForPurpose('WORKSHOP'), 'marketing')
  assert.equal(streamForPurpose('TRANSACTIONAL'), 'transactional')
  assert.equal(streamForPurpose('APPOINTMENT'), 'transactional')
  assert.equal(streamForPurpose('SERVICING'), 'transactional')
  assert.equal(streamForPurpose('POLICY_DEADLINE'), 'transactional')
})

t('absent purpose defaults to marketing (gated path is the campaign path — isolates notify.)', () => {
  assert.equal(streamForPurpose(null), 'marketing')
  assert.equal(streamForPurpose(undefined), 'marketing')
})

console.log('senders — domain parsing')

t('emailDomainOf handles "Name <a@b>" and bare "a@b"', () => {
  assert.equal(emailDomainOf('Markist <notify@notify.markistfsa.com>'), 'notify.markistfsa.com')
  assert.equal(emailDomainOf('markist@mail.markistfsa.com'), 'mail.markistfsa.com')
  assert.equal(emailDomainOf(''), null)
  assert.equal(emailDomainOf(null), null)
  assert.equal(emailDomainOf('no-at-sign'), null)
})

clearEnv()
console.log(`\n✅ comms-email-senders: ${passed} passed`)
