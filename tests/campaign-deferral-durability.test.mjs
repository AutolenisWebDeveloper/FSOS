// DEFERRAL DURABILITY proof — a gate deferral must never burn a campaign touch.
//
// The defect this file regresses: every engine tick claimed the touch's execution row,
// called sendMessage, and then ADVANCED THE CURSOR REGARDLESS of the outcome. A send held
// by a self-clearing gate deferral (configured window, business hours, frequency,
// collision, or the SMS A2P hold) was therefore terminal in practice: the execution row
// stayed behind, the cursor marched past it, and a later re-claim conflicted on the
// existing row — the touch never re-attempted. "A deferred POLICY_DEADLINE that never
// re-attempts is the exact failure the exempt-purpose defer rule exists to prevent."
//
// The fix under test: fireMessageTouch returns a tri-state ('sent' | 'blocked' |
// 'deferred'); on a deferral it RELEASES the idempotency claim (deletes the execution
// row) so the still-due enrollment re-claims and re-attempts on the next tick, and the
// loop holds the cursor. Hard blocks (consent, DNC, securities, template …) stay
// terminal 'suppressed' executions exactly as before.
//
// Anti-false-green: the deferral/terminal decision is made by the REAL gate.ts
// classifier (compiled and loaded — a spy wrapper proves it was consulted), not by a stub
// that agrees with the code under test. All four engine fireMessageTouch implementations
// are the REAL ones.
// Run: node tests/campaign-deferral-durability.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

// ── The REAL gate classifier ─────────────────────────────────────────────────
const gateOut = mkdtempSync(join(tmpdir(), 'fsos-defer-gate-'))
process.on('exit', () => { try { rmSync(gateOut, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(
  `npx tsc src/lib/comms/gate.ts --rootDir src --outDir ${gateOut} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'ignore' },
)
const realGate = require(join(gateOut, 'lib/comms/gate.js'))

// ── The four REAL engine implementations ─────────────────────────────────────
const engines = [
  { key: 'life', src: 'src/lib/life-campaign/tick.ts', table: 'life_campaign_executions' },
  { key: 'xsell', src: 'src/lib/cross-sell-life/tick.ts', table: 'xsell_life_campaign_executions' },
  { key: 'pw', src: 'src/lib/pipeline-winback/tick.ts', table: 'pipeline_winback_executions' },
  { key: 'district', src: 'src/lib/district-nurture/tick.ts', table: 'district_nurture_executions' },
]
for (const eng of engines) {
  eng.out = mkdtempSync(join(tmpdir(), `fsos-defer-${eng.key}-`))
  try {
    execSync(
      `npx tsc ${eng.src} --outDir ${eng.out} --module commonjs --target es2020 ` +
        `--moduleResolution node --skipLibCheck --esModuleInterop`,
      { stdio: 'ignore' },
    )
  } catch { /* expected TS2307 on '@/…' aliases; JS still emits */ }
  if (!existsSync(join(eng.out, 'tick.js'))) { console.error(`FATAL: ${eng.key} tick.js not emitted`); process.exit(1) }
}

// ── Module hooks: real send spy, REAL gate (spied), controllable A2P ─────────
const sendState = { next: null, calls: 0 }
const seen = { classifier: 0 }
const a2pState = { approved: true }
const sendModuleStub = {
  __esModule: true,
  sendMessage: async () => { sendState.calls++; return sendState.next },
  isTemplateApproved: async () => true,
}
const gateModuleStub = {
  __esModule: true,
  ...realGate,
  isDeferralGateStep: (s) => { seen.classifier++; return realGate.isDeferralGateStep(s) },
}
const a2pModuleStub = { __esModule: true, smsA2pApproved: () => a2pState.approved }
const makeStub = () => new Proxy(function () {}, {
  get: (_t, prop) => (prop === '__esModule' ? true : makeStub()),
  apply: () => makeStub(),
})
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/comms/send') return sendModuleStub
  if (request === '@/lib/comms/gate') return gateModuleStub
  if (request === '@/lib/comms/a2p') return a2pModuleStub
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return makeStub()
  return origLoad.call(this, request, ...rest)
}
const impls = {}
for (const eng of engines) impls[eng.key] = require(join(eng.out, 'tick.js')).fireMessageTouch

// ── Chainable mock DB capturing every write, INCLUDING deletes ───────────────
const MEMBER = { email: 'client@example.com', phone: '+15550100', full_name: 'Client Name' }
function makeDb(tplChannel) {
  const captured = []
  const from = (table) => {
    const b = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({
        data: table === 'comm_templates'
          ? { channel: tplChannel, body: 'Subject: Note\n\nHello there.', introduces_sender: false, version: 3 }
          : (table === 'household_members' || table === 'contacts') ? MEMBER
          : null,
        error: null,
      }),
      update: (obj) => { captured.push({ table, op: 'update', obj }); return b },
      insert: (obj) => { captured.push({ table, op: 'insert', obj }); return b },
      delete: () => { captured.push({ table, op: 'delete' }); return b },
    }
    return b
  }
  return { db: { from }, captured }
}

const cfg = { id: 'c1', purpose: 'MARKETING' }
const baseE = {
  id: 'enr1', member_id: 'm1', contact_id: 'ct1', household_id: 'h1', agency_id: 'a1',
  policy_id: 'p1', campaign_id: 'c1', campaign_version: 1, baseline_date: '2026-01-01',
  current_touch_no: 0, agency_owner_id: 'ao1', opportunity_id: 'op1',
  email: 'client@example.com', phone: '+15550100',
}
const touch = { touch_no: 1, kind: 'email', template_id: 'tpl1', playbook_key: null, asset_label: null }
const dispatchCtx = { purpose: 'MARKETING', delegation: undefined, ownership: undefined }
const NOW = '2026-08-29T16:00:00.000Z'

async function fire(engineKey, outcome, { channel = 'email', a2p = true } = {}) {
  sendState.next = outcome
  sendState.calls = 0
  a2pState.approved = a2p
  const { db, captured } = makeDb(channel)
  const ret = await impls[engineKey](db, cfg, { ...baseE }, 1, { ...touch }, dispatchCtx, NOW)
  return { ret, captured, calls: sendState.calls }
}

const deletesOn = (captured, table) => captured.filter((c) => c.op === 'delete' && c.table === table)
const statusWrites = (captured) => captured.filter((c) => c.op === 'update' && c.obj && typeof c.obj.status === 'string')

// Gate outcomes as sendMessage returns them (shape matched to send.ts SendOutcome).
const DEFER = {
  sent: false, blocked: true, messageId: null,
  reason: 'Outside the configured campaign window (13:00–18:00 recipient-local) — deferred to the next opening.',
  gate: { allowed: false, escalate: false, blockedStep: 'configured_window' },
}
const HARD = {
  sent: false, blocked: true, messageId: null, reason: 'No SMS consent on record for this purpose.',
  gate: { allowed: false, escalate: true, blockedStep: 'consent' },
}
const SENT = { sent: true, blocked: false, messageId: 'msg1', reason: undefined, gate: { allowed: true, escalate: false, blockedStep: null } }

const results = []
const record = (name, fn) => Promise.resolve().then(fn).then(
  () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
  (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
)

// ── The classifier itself (pure) ─────────────────────────────────────────────
console.log('DEFERRAL_GATE_STEPS — the single source of truth for what may retry')

await record('deferral set is exactly {sms_live, business_hours, frequency, collision, configured_window}', async () => {
  for (const s of ['sms_live', 'business_hours', 'frequency', 'collision', 'configured_window']) {
    assert.equal(realGate.isDeferralGateStep(s), true, `${s} must be a deferral`)
  }
  // Everything terminal or escalating stays terminal — a suppression released for retry
  // would re-attempt a send a human or a rule already refused.
  for (const s of ['quiet_hours', 'consent', 'dnc', 'suppression', 'is_security', 'recommendation',
    'approved_template', 'timezone_unresolved', 'window_misconfigured', 'ai_authority',
    'message_content', 'ownership', 'delegation', 'data_confidence', 'other_rule', null, undefined, '']) {
    assert.equal(realGate.isDeferralGateStep(s), false, `${String(s)} must stay terminal`)
  }
})

// ── Every engine honors the tri-state ────────────────────────────────────────
for (const eng of engines) {
  console.log(`\n${eng.key} — deferrals release the claim; hard blocks stay terminal`)

  await record(`${eng.key}: configured_window → 'deferred', claim RELEASED, no terminal execution recorded`, async () => {
    seen.classifier = 0
    const r = await fire(eng.key, DEFER)
    assert.equal(r.ret, 'deferred', 'the loop must be told to hold the cursor')
    assert.ok(seen.classifier >= 1, 'the REAL gate classifier decided (the check actually ran)')
    assert.equal(deletesOn(r.captured, eng.table).length, 1, 'the idempotency claim row was deleted for re-claim')
    assert.equal(statusWrites(r.captured).length, 0, 'no suppressed/sent execution may be recorded for a deferral')
  })

  await record(`${eng.key}: consent (hard block) → 'blocked', terminal suppressed execution, claim KEPT`, async () => {
    const r = await fire(eng.key, HARD)
    assert.equal(r.ret, 'blocked')
    assert.equal(deletesOn(r.captured, eng.table).length, 0, 'a compliance verdict is never released for retry')
    const s = statusWrites(r.captured)
    assert.equal(s.length, 1, 'exactly one terminal execution write')
    assert.equal(s[s.length - 1].obj.status, 'suppressed')
  })

  await record(`${eng.key}: delivered → 'sent' with a terminal sent execution`, async () => {
    const r = await fire(eng.key, SENT)
    assert.equal(r.ret, 'sent')
    assert.equal(deletesOn(r.captured, eng.table).length, 0)
    const s = statusWrites(r.captured)
    assert.equal(s[s.length - 1].obj.status, 'sent')
  })

  await record(`${eng.key}: SMS A2P hold → 'deferred' BEFORE dispatch, claim released, dispatcher never called`, async () => {
    // Pre-fix this marked the row 'scheduled' and returned false: the loop advanced the
    // cursor anyway and the next tick's re-claim conflicted on the leftover row — the
    // touch was burned despite the comment promising a retry.
    const r = await fire(eng.key, SENT, { channel: 'sms', a2p: false })
    assert.equal(r.ret, 'deferred')
    assert.equal(r.calls, 0, 'sendMessage must never be reached during the hold')
    assert.equal(deletesOn(r.captured, eng.table).length, 1, 'the claim is released so the touch re-attempts')
  })
}

Module._load = origLoad

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) {
  console.error(`\n${failed.length} deferral-durability assertion(s) FAILED — build-blocking.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} deferral-durability proofs passed (no engine burns a deferred touch).`)
