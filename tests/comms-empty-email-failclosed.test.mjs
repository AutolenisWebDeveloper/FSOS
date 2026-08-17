// P1-A FAIL-CLOSED PROOF — an empty/whitespace EMAIL body must be WITHHELD on the real
// sendThroughGate path, before the branded-shell wrap, on EVERY caller (broadcast / drip / legacy).
//
// Root cause (audit P1-A, the email sibling of F-2): the gate's `message_content` backstop
// validates req.body, but for EMAIL sendThroughGate wraps the authored body in the branded shell
// (Farmers logo + CAN-SPAM footer) BEFORE dispatch — so the gate never sees an empty body, and an
// empty template shipped as a signature-only "near-empty" email. The campaign ticks guard upstream;
// dispatchCampaign / dripAdvance / legacy campaigns/run did not. The fix adds a fail-closed guard on
// the AUTHORED body at the single send choke-point (send.ts, before the wrap).
//
// tests/comms-message-validation.test.mjs already proves the GATE blocks an empty body when the body
// reaches it directly. THIS test proves the deeper guarantee in the REAL sendThroughGate: an empty
// EMAIL is withheld before the wrap can mask it, and the dispatcher/provider is never reached — while
// a valid email (and a valid SMS) still dispatch, so the guard blocks ONLY on the emptiness it exists
// for.
// Run: node tests/comms-empty-email-failclosed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const out = mkdtempSync(join(tmpdir(), 'fsos-empty-email-'))
try { symlinkSync(join(repoRoot, 'node_modules'), join(out, 'node_modules'), 'dir') } catch { /* linked */ }
try {
  execSync(
    `npx tsc src/lib/comms/send.ts --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'ignore' },
  )
} catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
if (!existsSync(join(out, 'comms/send.js'))) { console.error('FATAL: send.js not emitted'); process.exit(1) }

// ── Spy dispatcher + a HEALTHY message-of-record insert (so the ONLY thing that can block is the
// empty-body guard, which runs before the insert). ─────────────────────────────────────────────
const dispatchCalls = []

function fakeDb() {
  const from = (table) => {
    let op = 'select'
    const b = {
      select: () => b, eq: () => b, neq: () => b, in: () => b, is: () => b, not: () => b,
      gte: () => b, lte: () => b, gt: () => b, lt: () => b, order: () => b, limit: () => b,
      insert: () => { op = 'insert'; return b }, update: () => { op = 'update'; return b },
      upsert: () => { op = 'upsert'; return b }, delete: () => { op = 'delete'; return b },
      async maybeSingle() { return resolve_() },
      async single() { return resolve_() },
      then(res, rej) { return Promise.resolve(resolve_()).then(res, rej) },
    }
    function resolve_() {
      if (table === 'comm_messages' && op === 'insert') return { data: { id: 'msg_ok_1' }, error: null }
      return { data: null, error: null }
    }
    return b
  }
  return { from }
}

const makeStub = () => new Proxy(function () {}, {
  get: (_t, p) => (p === '__esModule' ? true : p === 'then' ? undefined : makeStub()),
  apply: () => makeStub(),
})
const REAL = {
  getDb: () => fakeDb(),
  dispatch: async (req) => { dispatchCalls.push(req); return { sent: true, gate: { allowed: true, escalate: false }, escalated: false, providerId: 'prov_1' } },
  normalizeContact: (_c, v) => v,
  getOrCreateConversation: async () => null,
  touchConversation: async () => {},
  // personalize returns the body unchanged so an empty template stays empty and a real body stays real.
  personalize: (b) => b,
  unresolvedBlockingTokens: () => [],
  buildRecipientContext: () => ({}),
  loadHoursPolicy: async () => ({}),
  isWithinOperatingHours: async () => true,
  quietHoursApply: () => false,
  recordMessageEvent: async () => {},
  writeAudit: async () => ({ ok: true }),
  resolveAgentOfRecord: async () => null,
  resolvePolicySource: async () => null,
  enqueueAssignmentReview: async () => {},
  streamForPurpose: () => 'marketing',
  smsLiveFor: () => true,
  // email-shell wrap: return a NON-EMPTY branded shell for ANY input — this is precisely the shell
  // that used to mask an empty authored body. If the guard did not run first, an empty template
  // would arrive at dispatch as this non-empty string.
  wrapMarketingEmailBody: (body) => `<html><body><img src="logo"/>${body || ''}<footer>unsubscribe</footer></body></html>`,
  instrumentEmailHtml: (html) => html,
}
const modProxy = () => new Proxy({}, {
  get: (_t, name) => {
    if (name === '__esModule') return true
    if (name in REAL) return REAL[name]
    return makeStub()
  },
})
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return modProxy()
  return origLoad.call(this, request, ...rest)
}
const { sendThroughGate } = require(join(out, 'comms/send.js'))

const emailBase = {
  channel: 'email', to: 'client@example.com', subject: 'Your Farmers review',
  actor: 'system:test', entity: { type: 'comm_campaign_enrollment', id: 'enr1' },
  sourceKind: 'campaign_asset', sourceCampaignKey: 'native_broadcast',
}

const results = []
const record = (name, fn) => Promise.resolve().then(fn).then(
  () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
  (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
)

console.log('P1-A fail-closed proof (real sendThroughGate, spy dispatcher, real branded-shell mask)\n')

// 1. Empty EMAIL body → withheld before the wrap; dispatcher NEVER reached.
dispatchCalls.length = 0
const emptyEmail = await sendThroughGate({ ...emailBase, body: '' })
await record('empty email body → outcome.sent === false', () => assert.equal(emptyEmail.sent, false))
await record('empty email body → outcome.blocked === true', () => assert.equal(emptyEmail.blocked, true))
await record('empty email body → dispatcher/provider NEVER invoked (wrap could not mask it)', () =>
  assert.equal(dispatchCalls.length, 0, 'dispatch was called despite an empty authored email body'))
await record('empty email body → escalating block, reason names emptiness', () => {
  assert.equal(emptyEmail.gate.escalate, true)
  assert.match(emptyEmail.reason || '', /empty/i)
})

// 2. Whitespace-only EMAIL body → same.
dispatchCalls.length = 0
const wsEmail = await sendThroughGate({ ...emailBase, body: '   \n\t  ' })
await record('whitespace-only email body → blocked, never dispatched', () => {
  assert.equal(wsEmail.sent, false)
  assert.equal(dispatchCalls.length, 0)
})

// 3. Control: a REAL email body → the send reaches the dispatcher (guard blocks only on emptiness).
dispatchCalls.length = 0
const okEmail = await sendThroughGate({ ...emailBase, body: 'Hi {{first_name}}, ready to book your review?' })
await record('control — non-empty email body → dispatcher IS invoked exactly once', () =>
  assert.equal(dispatchCalls.length, 1))
await record('control — non-empty email body → outcome.sent === true', () =>
  assert.equal(okEmail.sent, true))

// 4. Control: a REAL SMS body still dispatches (no regression to the SMS path).
dispatchCalls.length = 0
const okSms = await sendThroughGate({
  channel: 'sms', to: '+15550100', body: 'Your review is confirmed for tomorrow at 10am.',
  actor: 'system:test', entity: { type: 'life_campaign_enrollment', id: 'enr2' },
  sourceKind: 'campaign_asset', sourceCampaignKey: 'life_conversion',
})
await record('control — non-empty SMS body → dispatcher invoked (SMS path unchanged)', () =>
  assert.equal(dispatchCalls.length, 1))

Module._load = origLoad
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} P1-A fail-closed assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} P1-A fail-closed proofs passed.`)
