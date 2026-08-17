// P1-B PROOF — per-recipient FREQUENCY caps apply to a PURPOSELESS campaign send.
//
// Root cause (audit P1-B): sendThroughGate computed `withinFrequencyCaps` only inside
// `if (ctx.purpose)`. A campaign with no purpose — and the entire legacy `/api/campaigns/run`
// drip, which never sets one — therefore reached the gate with `withinFrequencyCaps: undefined`,
// which the gate treats as a pass. Result: no min-interval / SMS-per-day / marketing-email-per-day
// / combined-touch cap on those sends. The fix defaults an unclassified send to MARKETING for
// capping (the same default streamForPurpose + quietHoursApply already use) and wires the frequency
// decision into the gate for EVERY send, while leaving purpose-scoped consent + §10 collision opt-in
// to an explicit purpose.
//
// This drives the REAL sendThroughGate with NO purpose and a spy dispatcher that captures the gate
// context, proving the frequency decision is now carried into the gate (defined, not undefined) and
// reflects resolveSendPolicy's verdict. comms-policy.test.mjs proves the gate then defers on a
// frequency block; this proves send.ts POPULATES the decision for a purposeless send.
// Run: node tests/comms-frequency-purposeless.test.mjs
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
const out = mkdtempSync(join(tmpdir(), 'fsos-freq-purposeless-'))
try { symlinkSync(join(repoRoot, 'node_modules'), join(out, 'node_modules'), 'dir') } catch { /* linked */ }
try {
  execSync(
    `npx tsc src/lib/comms/send.ts --outDir ${out} --module commonjs --target es2020 ` +
      `--moduleResolution node --skipLibCheck --esModuleInterop`,
    { stdio: 'ignore' },
  )
} catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
if (!existsSync(join(out, 'comms/send.js'))) { console.error('FATAL: send.js not emitted'); process.exit(1) }

const dispatchCalls = []
let frequencyAllowed = true
let lastPolicyInput = null

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
  dispatch: async (req) => { dispatchCalls.push(req); return { sent: true, gate: { allowed: true, escalate: false }, escalated: false, providerId: 'p1' } },
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
  wrapMarketingEmailBody: (body) => `<html><body>${body || ''}</body></html>`,
  instrumentEmailHtml: (h) => h,
  // The unit under observation: send.ts must call this even when ctx.purpose is absent.
  resolveSendPolicy: async (input) => {
    lastPolicyInput = input
    return {
      consentForPurpose: null,
      frequency: { allowed: frequencyAllowed, reason: frequencyAllowed ? undefined : 'Max SMS/day reached (3).' },
      collision: { allowed: true },
      isMarketing: true,
    }
  },
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

// A PURPOSELESS campaign send (no `purpose` field) — the legacy-drip / unclassified-campaign shape.
const purposelessSms = {
  channel: 'sms', to: '+15550100', body: 'Quick note about your coverage.',
  actor: 'system:test', entity: { type: 'comm_campaign_enrollment', id: 'enr1' },
  memberId: 'mem_1', sourceKind: 'campaign_asset', sourceCampaignKey: 'legacy_drip',
}

const results = []
const record = (name, fn) => Promise.resolve().then(fn).then(
  () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
  (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
)

console.log('P1-B proof — frequency caps apply to a purposeless send\n')

// 1. resolveSendPolicy is invoked for a purposeless send, defaulting the purpose to MARKETING.
frequencyAllowed = true
dispatchCalls.length = 0
lastPolicyInput = null
await sendThroughGate({ ...purposelessSms })
await record('resolveSendPolicy IS called for a purposeless send', () =>
  assert.ok(lastPolicyInput, 'policy resolver was never called (caps skipped)'))
await record('unclassified send defaults to MARKETING for capping', () =>
  assert.equal(lastPolicyInput.purpose, 'MARKETING'))

// 2. The frequency verdict is carried into the gate (defined, not undefined) — allowed case.
await record('purposeless send carries withinFrequencyCaps === true into the gate', () => {
  assert.equal(dispatchCalls.length, 1)
  assert.equal(dispatchCalls[0].gate.withinFrequencyCaps, true)
})

// 3. When the cap is exceeded, the purposeless send carries withinFrequencyCaps === false
//    (pre-fix this was `undefined` ⇒ the gate auto-passed and the send went uncapped).
frequencyAllowed = false
dispatchCalls.length = 0
await sendThroughGate({ ...purposelessSms })
await record('cap exceeded → purposeless send carries withinFrequencyCaps === false', () => {
  assert.equal(dispatchCalls.length, 1)
  assert.equal(dispatchCalls[0].gate.withinFrequencyCaps, false)
  assert.match(dispatchCalls[0].gate.frequencyReason || '', /max sms/i)
})

// 4. Consent replacement + collision stay OPT-IN to an explicit purpose: a purposeless send never
//    populates collisionPaused (behavior unchanged apart from frequency).
await record('purposeless send does NOT populate collisionPaused (unchanged §10 behavior)', () => {
  assert.equal(dispatchCalls[0].gate.collisionPaused, undefined)
})

Module._load = origLoad
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} P1-B assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} P1-B proofs passed.`)
