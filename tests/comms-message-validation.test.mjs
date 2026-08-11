// F-2 REGRESSION PROOF — an invalid message can NEVER reach a provider.
//
// The August 7, 2026 incident: an email template resolved onto the SMS channel with an
// empty body, and ~67 real clients received a blank SMS (only the appended opt-out footer).
// The per-engine fail-closed (tests/campaign-template-failclosed.test.mjs) stops the three
// campaign ticks. THIS test proves the ARCHITECTURAL backstop one layer deeper — the pure
// gate (gate.ts step `message_content`) and the provider wrappers (messaging.ts) — so that
// NO caller, campaign or otherwise, can dispatch:
//   • an empty or whitespace-only SMS/email body,
//   • email/HTML content routed onto the SMS channel (the Aug-7 mode), or
//   • an unsupported channel.
//
// It drives the REAL evaluateGate + the REAL dispatch() with spy side-effects, asserting the
// provider send() is NEVER invoked, and calls the REAL messaging.ts guards directly.
// Run: node tests/comms-message-validation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-msgvalid-'))
// messaging.ts imports the external 'resend' package at module top-level; symlink the repo's
// node_modules next to the compiled output so require() resolves it from the temp dir.
try { symlinkSync(join(repoRoot, 'node_modules'), join(out, 'node_modules'), 'dir') } catch { /* already linked */ }
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/comms/dispatcher.ts src/lib/messaging.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { dispatch } = require(join(out, 'comms/dispatcher.js'))
const { sendSms, sendEmail } = require(join(out, 'messaging.js'))

const results = []
function record(id, name, fn) {
  try {
    // fn may be async
    const r = fn()
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { results.push({ id, name, pass: true }); console.log(`  ✓ ${name}`) },
        (e) => { results.push({ id, name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
      )
    }
    results.push({ id, name, pass: true }); console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ id, name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`)
  }
}

// A fully-permissive gate context — every OTHER step passes, so ONLY content integrity can block.
const okGate = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }

// A realistic email-template body (what mis-resolved onto SMS on Aug 7).
const EMAIL_BODY =
  '<!doctype html><html><body><table><tr><td><h1>Your review is ready</h1>' +
  '<p>Hi there, let’s schedule your complimentary review.</p></td></tr></table></body></html>'

console.log('F-2 content-integrity proof (real gate + real dispatcher + real messaging guards)\n')
console.log('1. Pure gate blocks invalid content (escalating, first-fail):')

record(1, 'empty SMS body → blocked message_content + escalate', () => {
  const r = evaluateGate({ draft: '', channel: 'sms', ...okGate })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'message_content')
  assert.equal(r.escalate, true)
})
record(2, 'whitespace-only SMS body → blocked message_content', () => {
  const r = evaluateGate({ draft: '   \n\t  ', channel: 'sms', ...okGate })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'message_content')
})
record(3, 'empty email body → blocked message_content', () => {
  const r = evaluateGate({ draft: '', channel: 'email', ...okGate })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'message_content')
})
record(4, 'Aug-7 mode: email/HTML template on SMS channel → blocked message_content', () => {
  const r = evaluateGate({ draft: EMAIL_BODY, channel: 'sms', ...okGate })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'message_content')
  assert.equal(r.escalate, true)
})
record(5, 'unsupported channel → blocked message_content', () => {
  const r = evaluateGate({ draft: 'hello', channel: 'push', ...okGate })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'message_content')
})
record(6, 'content check runs FIRST — empty body reports message_content, not a later step', () => {
  // No consent + empty body: content must win (it is checked before consent).
  const r = evaluateGate({ draft: '', channel: 'sms', ...okGate, hasConsent: false })
  assert.equal(r.blockedStep, 'message_content')
})
record(7, 'a valid SMS body passes content integrity (allowed)', () => {
  const r = evaluateGate({ draft: 'Your review is tomorrow at 10am.', channel: 'sms', ...okGate })
  assert.equal(r.allowed, true)
})

console.log('\n2. Real dispatcher NEVER reaches the provider for invalid content:')
function makeSpies() {
  const calls = { compliance: [], escalation: [], audit: [], send: [] }
  const deps = {
    recordComplianceEvent: async (req, gate) => { calls.compliance.push({ req, gate }) },
    createEscalation: async (req, gate) => { calls.escalation.push({ req, gate }) },
    writeAudit: async (entry) => { calls.audit.push(entry) },
    send: async (channel, to, body) => { calls.send.push({ channel, to, body }); return { ok: true, id: 'prov_1' } },
  }
  return { calls, deps }
}
async function notDispatched(id, name, req) {
  const { calls, deps } = makeSpies()
  const r = await dispatch(req, deps)
  return record(id, name, () => {
    assert.equal(r.sent, false, 'must NOT send')
    assert.equal(r.gate.blockedStep, 'message_content', 'blocked at message_content')
    assert.equal(calls.send.length, 0, 'provider send() NEVER invoked')
  })
}

await notDispatched(8, 'empty SMS never dispatched (footer cannot rescue an empty body)', {
  channel: 'sms', to: '+15550100', body: '', actor: 'system', entity: { type: 'household', id: 'h1' }, gate: { ...okGate },
})
await notDispatched(9, 'Aug-7: email-template-on-SMS never dispatched', {
  channel: 'sms', to: '+15550100', body: EMAIL_BODY, actor: 'system', entity: { type: 'household', id: 'h1' }, gate: { ...okGate },
})
await notDispatched(10, 'empty email never dispatched', {
  channel: 'email', to: 'x@y.com', subject: 'Hi', body: '   ', actor: 'system', entity: { type: 'household', id: 'h1' }, gate: { ...okGate },
})

console.log('\n3. Provider wrappers (messaging.ts) fail closed at the last line before the API:')
// Set dummy provider env + A2P approval so execution reaches the body guard (not the earlier
// config/A2P short-circuits). No network call is made — the guard returns first.
process.env.SMS_A2P_APPROVED = 'true'
process.env.TWILIO_ACCOUNT_SID = 'AC_test'
process.env.TWILIO_AUTH_TOKEN = 'tok_test'
process.env.TWILIO_PHONE_NUMBER = '+15550000'
process.env.RESEND_API_KEY = 're_test'
process.env.RESEND_FROM_EMAIL = 'noreply@example.com'

await record(11, 'sendSms("", empty) → empty_sms_body (no Twilio call)', async () => {
  const r = await sendSms('+15550100', '   ')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'empty_sms_body')
})
await record(12, 'sendSms with HTML body → html_body_in_sms (no Twilio call)', async () => {
  const r = await sendSms('+15550100', EMAIL_BODY)
  assert.equal(r.ok, false)
  assert.equal(r.error, 'html_body_in_sms')
})
await record(13, 'sendEmail with empty html → empty_email_body (no Resend call)', async () => {
  const r = await sendEmail('x@y.com', 'Subject', '   ')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'empty_email_body')
})

console.log('')
const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`${failed.length}/${results.length} F-2 content-validation assertion(s) FAILED — build-blocking defect.`)
  process.exit(1)
}
console.log(`All ${results.length} F-2 content-validation proofs passed.`)
