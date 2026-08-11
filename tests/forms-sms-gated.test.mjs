// FORMS SMS routed through the ONE gate (audit finding F-3). Before the fix, sendForm placed the
// form-link SMS with a RAW inline Twilio fetch that bypassed the compliance gate, the A2P backstop,
// DNC/STOP, consent, the securities firewall, and the message-of-record. This proves the fix:
//
//   Part A — no raw Twilio path remains reachable in src/lib/forms.ts (source invariant).
//   Part B — sendForm(channel:'sms') routes through sendThroughGate with the correct context:
//            channel=sms, purpose=TRANSACTIONAL, humanAuthored=true, consent NOT waived, the
//            form_submission entity, an E.164 recipient, and NO self-appended STOP footer (the
//            dispatcher adds it). A gate-accepted send records form_sends; a gate BLOCK does not.
//   Part C — the REAL gate (evaluateGate) + purpose model: a TRANSACTIONAL SMS is quiet-hours-
//            EXEMPT, but consent, DNC/STOP, and the securities firewall STILL block it.
//
// Harness mirrors campaign-gate.test.mjs / campaign-template-failclosed.test.mjs: compile the real
// modules with the project tsc and require them with a Module._load hook that supplies the real
// send-module spy and inert stubs for the rest.
// Run: node tests/forms-sms-gated.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const results = []
const record = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(
      () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
      (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
    )

// ── Part A — the raw Twilio path is gone (source invariant) ───────────────────
console.log('Part A — no raw Twilio path remains in forms.ts')
const formsSrc = readFileSync('src/lib/forms.ts', 'utf8')
await record('forms.ts contains no api.twilio.com call', () =>
  assert.ok(!/api\.twilio\.com/.test(formsSrc), 'raw Twilio REST endpoint still present'))
await record('forms.ts reads no TWILIO_* env for sending', () =>
  assert.ok(!/TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER/.test(formsSrc), 'raw Twilio creds still read'))
await record('forms.ts routes SMS through sendThroughGate', () =>
  assert.ok(/sendThroughGate\(/.test(formsSrc) && /@\/lib\/comms\/send/.test(formsSrc), 'not wired to the gate'))

// ── Part B — sendForm(sms) executes through the gate with the right context ───
console.log('\nPart B — sendForm(channel:"sms") flows through sendThroughGate with the correct context')
const outForms = mkdtempSync(join(tmpdir(), 'fsos-forms-'))
try {
  execSync(
    `npx tsc src/lib/forms.ts --outDir ${outForms} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'ignore' },
  )
} catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
if (!existsSync(join(outForms, 'forms.js'))) { console.error('FATAL: forms.js not emitted'); process.exit(1) }

let gateCtx = null
const formsSubmissionsInserts = []
const formSendsInserts = []
const sendStub = {
  __esModule: true,
  sendThroughGate: async (ctx) => { gateCtx = ctx; return { sent: true, blocked: false, reason: undefined } },
}
const mockDb = {
  from: (table) => {
    const b = {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { submission_id: 'sub_test1' }, error: null }),
      insert: (obj) => {
        if (table === 'form_submissions') formsSubmissionsInserts.push(obj)
        if (table === 'form_sends') formSendsInserts.push(obj)
        return b
      },
    }
    return b
  },
}
const makeStub = () => new Proxy(function () {}, {
  get: (_t, prop) => (prop === '__esModule' ? true : makeStub()),
  apply: () => makeStub(),
})
const specific = {
  '@/lib/comms/send': sendStub,
  '@/lib/supabase/client': { __esModule: true, getDb: () => mockDb },
  '@/lib/tokens': { __esModule: true, generateFormToken: () => 'tok_test123' },
}
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request in specific) return specific[request]
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return makeStub()
  return origLoad.call(this, request, ...rest)
}
const { sendForm } = require(join(outForms, 'forms.js'))

const res = await sendForm({
  form_id: 'customer-questionnaire',
  channel: 'sms',
  phone: '5551234567', // bare 10-digit → normalized to E.164 by the fix
  client_name: 'Dana',
  // no customer_id → skips the dedupe branch; keeps the test focused on the send path
})

await record('sendThroughGate was invoked for the forms SMS (no raw path)', () =>
  assert.ok(gateCtx, 'sendThroughGate was never called'))
await record('gate ctx: channel = sms', () => assert.equal(gateCtx.channel, 'sms'))
await record('gate ctx: purpose = TRANSACTIONAL (quiet-hours- & marketing-consent-exempt)', () =>
  assert.equal(gateCtx.purpose, 'TRANSACTIONAL'))
await record('gate ctx: humanAuthored = true (operator-approved 1:1, satisfies gate step 4)', () =>
  assert.equal(gateCtx.humanAuthored, true))
await record('gate ctx: consent is NOT waived (recipient without consent is blocked by the gate)', () =>
  assert.equal(gateCtx.consentWaived, undefined))
await record('gate ctx: entity = form_submission (audit + message-of-record linkage)', () => {
  assert.equal(gateCtx.entity.type, 'form_submission')
  assert.equal(gateCtx.entity.id, 'sub_test1')
})
await record('gate ctx: recipient normalized to E.164', () => assert.equal(gateCtx.to, '+15551234567'))
await record('gate ctx: body carries NO self-appended STOP footer (dispatcher adds it once)', () => {
  assert.ok(gateCtx.body.startsWith('Hi Dana,'), 'body preamble intact')
  assert.ok(!/Reply STOP/i.test(gateCtx.body), 'forms must not append the footer itself')
})
await record('a gate-accepted send records form_sends and reports sms_sent', () => {
  assert.equal(res.ok, true)
  assert.equal(res.sms_sent, true)
  assert.equal(formSendsInserts.length, 1)
  assert.equal(formSendsInserts[0].channel, 'sms')
})

// A gate BLOCK must NOT record a form_send and must surface the reason.
gateCtx = null
sendStub.sendThroughGate = async (ctx) => { gateCtx = ctx; return { sent: false, blocked: true, reason: 'No valid channel consent on file.' } }
formSendsInserts.length = 0
const blockedRes = await sendForm({ form_id: 'customer-questionnaire', channel: 'sms', phone: '5551234567', client_name: 'Dana' })
await record('a gate BLOCK writes no form_send and surfaces the reason', () => {
  assert.equal(blockedRes.sms_sent, false)
  assert.equal(formSendsInserts.length, 0, 'no form_sends row on a blocked send')
  assert.equal(blockedRes.sms_error, 'No valid channel consent on file.')
})
Module._load = origLoad

// ── Part C — the REAL gate + purpose model back the forms classification ──────
console.log('\nPart C — real gate/purpose: TRANSACTIONAL SMS is quiet-hours-exempt, but consent/DNC/securities still block')
const outGate = mkdtempSync(join(tmpdir(), 'fsos-gate-'))
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/comms/purpose.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${outGate} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'ignore' },
)
const { evaluateGate } = require(join(outGate, 'comms/gate.js'))
const { quietHoursApply } = require(join(outGate, 'comms/purpose.js'))

await record('purpose: quietHoursApply(sms, TRANSACTIONAL) === false (forms SMS is quiet-hours-exempt)', () =>
  assert.equal(quietHoursApply('sms', 'TRANSACTIONAL'), false))

// The gate context a forms SMS produces: humanAuthored → approved=true; TRANSACTIONAL → quietHoursExempt=true.
const formsGate = (over) => ({
  draft: 'Hi Dana, your secure form is ready.',
  channel: 'sms',
  hasConsent: true,
  recipientLocalHour: 22, // late night — would trip a marketing send
  quietHoursExempt: true, // TRANSACTIONAL
  onDNC: false,
  usesApprovedTemplateOrPolicy: true, // humanAuthored
  isSecurity: false,
  ...over,
})
await record('gate: transactional forms SMS at 22:00 is ALLOWED (quiet-hours-exempt)', () =>
  assert.equal(evaluateGate(formsGate({})).allowed, true))
await record('gate: no consent → BLOCKED on consent (consent still enforced, not waived)', () => {
  const g = evaluateGate(formsGate({ hasConsent: false }))
  assert.equal(g.allowed, false); assert.equal(g.blockedStep, 'consent')
})
await record('gate: on DNC/STOP → BLOCKED on dnc (opt-out honored)', () => {
  const g = evaluateGate(formsGate({ onDNC: true }))
  assert.equal(g.allowed, false); assert.equal(g.blockedStep, 'dnc')
})
await record('gate: securities-flagged → BLOCKED by the firewall', () => {
  const g = evaluateGate(formsGate({ isSecurity: true }))
  assert.equal(g.allowed, false); assert.equal(g.blockedStep, 'is_security')
})

// ── summary ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} forms-SMS assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} forms-SMS proofs passed (F-3: forms SMS goes through the one gate, no raw Twilio path).`)
