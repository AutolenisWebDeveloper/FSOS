// F-1 FAIL-CLOSED PROOF — a provider send must NEVER succeed while its §13.9 message-of-record
// silently fails to persist.
//
// Root cause (audit F-1): the World-2 campaign engines fed a per-campaign-table id into
// comm_messages.campaign_id (FK → comm_campaigns), so EVERY message-of-record insert failed the
// FK — silently, into an ignored `error` — and the provider send went out anyway. ~88 sends left
// no per-message record. The engine attribution fix (campaignId=null) is proven by
// tests/campaign-message-of-record.test.mjs. THIS test proves the deeper guarantee in
// sendThroughGate(): if the message-of-record insert errors (or returns no id) for ANY reason, the
// send is WITHHELD — the dispatcher/provider is never reached — instead of shipping an untraceable
// message.
//
// It drives the REAL sendThroughGate (compiled from src) with a fake DB whose comm_messages insert
// fails, and a SPY dispatcher, asserting: dispatch() is never called, the outcome is blocked, and
// the reason names the withheld record. A control case (insert succeeds) proves a healthy send DOES
// reach the dispatcher — so the guard blocks ONLY on the failure it exists for.
// Run: node tests/comms-message-of-record-failclosed.test.mjs
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
const out = mkdtempSync(join(tmpdir(), 'fsos-mor-failclosed-'))
try { symlinkSync(join(repoRoot, 'node_modules'), join(out, 'node_modules'), 'dir') } catch { /* linked */ }
try {
  execSync(
    `npx tsc src/lib/comms/send.ts --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'ignore' },
  )
} catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
if (!existsSync(join(out, 'comms/send.js'))) { console.error('FATAL: send.js not emitted'); process.exit(1) }

// ── Spy dispatcher + controllable message-of-record insert ──────────────────────
const dispatchCalls = []
let insertShouldFail = true

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
      if (table === 'comm_messages' && op === 'insert') {
        return insertShouldFail
          ? { data: null, error: { message: 'insert or update on "comm_messages" violates foreign key constraint "comm_messages_campaign_id_fkey"' } }
          : { data: { id: 'msg_ok_1' }, error: null }
      }
      return { data: null, error: null }
    }
    return b
  }
  return { from }
}

// Real-shaped stubs for exactly the helpers send.ts spreads/iterates/awaits before the insert;
// every other import falls back to a harmless proxy. This keeps the REAL sendThroughGate control
// flow intact up to (and past) the message-of-record insert.
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

const baseCtx = {
  channel: 'sms', to: '+15550100', body: 'Your review is confirmed for tomorrow at 10am.',
  actor: 'system:test', entity: { type: 'life_campaign_enrollment', id: 'enr1' },
  sourceKind: 'campaign_asset', sourceCampaignKey: 'life_conversion',
}

const results = []
const record = (name, fn) => Promise.resolve().then(fn).then(
  () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
  (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
)

console.log('F-1 fail-closed proof (real sendThroughGate, spy dispatcher)\n')

// 1. Insert FAILS → send withheld, dispatcher NEVER reached.
insertShouldFail = true
dispatchCalls.length = 0
const failOutcome = await sendThroughGate({ ...baseCtx })
await record('message-of-record insert fails → outcome.sent === false', () =>
  assert.equal(failOutcome.sent, false))
await record('message-of-record insert fails → outcome.blocked === true', () =>
  assert.equal(failOutcome.blocked, true))
await record('message-of-record insert fails → dispatcher/provider NEVER invoked', () =>
  assert.equal(dispatchCalls.length, 0, 'dispatch was called despite no message-of-record'))
await record('message-of-record insert fails → escalating block with a naming reason', () => {
  assert.equal(failOutcome.gate.escalate, true)
  assert.match(failOutcome.reason || '', /message-of-record/i)
})

// 2. Control: insert SUCCEEDS → the send DOES reach the dispatcher (guard blocks only on failure).
insertShouldFail = false
dispatchCalls.length = 0
const okOutcome = await sendThroughGate({ ...baseCtx })
await record('control — insert succeeds → dispatcher IS invoked exactly once', () =>
  assert.equal(dispatchCalls.length, 1))
await record('control — insert succeeds → outcome.sent === true', () =>
  assert.equal(okOutcome.sent, true))

Module._load = origLoad
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} F-1 fail-closed assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} F-1 fail-closed proofs passed.`)
