// FAIL-CLOSED template proof (audit finding F-2b) — the regression that would have caught the
// 67-blank-SMS incident. Before the fix, all three engine ticks derived the channel as
// `tpl?.channel === 'email' ? 'email' : 'sms'` and the body as `tpl?.body ?? ''`, so a template
// that resolved NULL (raced/deleted after the approval check), carried an unknown channel, or had
// an empty/whitespace body was DISPATCHED as an empty-body SMS. The fix adds a guard that skips the
// touch WITHOUT any dispatch.
//
// This drives the REAL fireMessageTouch of each engine (life, cross-sell, pipeline-winback) with a
// spy in place of sendMessage, and asserts:
//   • null template        → skipped(reason=template_unresolved),      sendMessage NEVER called
//   • empty/whitespace body → skipped(reason=template_body_empty),     sendMessage NEVER called
//   • invalid channel       → skipped(reason=template_channel_invalid), sendMessage NEVER called
//   • valid template        → advances PAST the guard and DOES dispatch (guard doesn't over-block)
//
// Harness: the ticks import via the '@/…' path alias, so they are compiled standalone with the
// project tsc (JS is emitted despite the expected TS2307 alias errors) and required with a
// Module._load hook that returns the real send-module spy for '@/lib/comms/send' and inert stubs
// for every other alias/relative import. The pure decision under test needs none of those, so it
// runs for real.
// Run: node tests/campaign-template-failclosed.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

const require = createRequire(import.meta.url)

const engines = [
  { key: 'life', src: 'src/lib/life-campaign/tick.ts' },
  { key: 'xsell', src: 'src/lib/cross-sell-life/tick.ts' },
  { key: 'pw', src: 'src/lib/pipeline-winback/tick.ts' },
]

for (const eng of engines) {
  eng.out = mkdtempSync(join(tmpdir(), `fsos-failclosed-${eng.key}-`))
  try {
    execSync(
      `npx tsc ${eng.src} --outDir ${eng.out} --module commonjs --target es2020 ` +
        `--moduleResolution node --skipLibCheck --esModuleInterop`,
      { stdio: 'ignore' },
    )
  } catch {
    // tsc exits non-zero on the expected TS2307 '@/…' alias errors — JS is still emitted.
  }
  if (!existsSync(join(eng.out, 'tick.js'))) {
    console.error(`FATAL: ${eng.key} tick.js was not emitted — cannot run the fail-closed proof.`)
    process.exit(1)
  }
}

// The real send-module spy: sendMessage counts calls; isTemplateApproved passes so execution
// reaches the template fetch + fail-closed guard under test.
const sendState = { calls: 0, approved: true }
const sendModuleStub = {
  __esModule: true,
  sendMessage: async () => {
    sendState.calls++
    return { sent: true, blocked: false, gate: { allowed: true, escalate: false } }
  },
  isTemplateApproved: async () => sendState.approved,
}
// Inert, endlessly-chainable stub for every other alias/relative import (none is on the code path).
const makeStub = () => new Proxy(function () {}, {
  get: (_t, prop) => (prop === '__esModule' ? true : makeStub()),
  apply: () => makeStub(),
})
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === '@/lib/comms/send') return sendModuleStub
  if (request.startsWith('@/') || request.startsWith('./') || request.startsWith('../')) return makeStub()
  return origLoad.call(this, request, ...rest)
}

const impls = {}
for (const eng of engines) impls[eng.key] = require(join(eng.out, 'tick.js')).fireMessageTouch

// Minimal chainable mock DB. comm_templates → the template under test; household_members/contacts →
// the (optional) recipient; every write is captured so we can read what status/reason was recorded.
function makeDb(tplData, memberData = null) {
  const captured = []
  const from = (table) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      maybeSingle: async () => ({
        data:
          table === 'comm_templates' ? tplData
          : table === 'household_members' || table === 'contacts' ? memberData
          : null,
        error: null,
      }),
      update: (obj) => { captured.push({ table, op: 'update', obj }); return b },
      insert: (obj) => { captured.push({ table, op: 'insert', obj }); return b },
    }
    return b
  }
  return { db: { from }, captured }
}

// The last markExecution write (the only update that carries a `status` field).
function recordedStatus(captured) {
  const s = captured.filter((c) => c.op === 'update' && c.obj && typeof c.obj.status === 'string')
  return s.length ? s[s.length - 1].obj : null
}

const cfg = { id: 'c1', purpose: 'MARKETING' }
const baseE = {
  id: 'enr1', member_id: 'm1', contact_id: null, household_id: 'h1', agency_id: 'a1',
  policy_id: 'p1', campaign_id: 'c1', baseline_date: '2026-01-01', current_touch_no: 0,
}
const touch = { touch_no: 1, kind: 'email', template_id: 'tpl1', asset_label: null }
const dispatchCtx = { purpose: 'MARKETING', delegation: undefined, ownership: undefined }
const NOW = '2026-08-10T16:00:00.000Z'

// A REACHABLE recipient (email AND phone) is supplied in EVERY case on purpose: it is what makes
// this a genuine regression test. Pre-fix, a null/empty/invalid template fell through to
// channel→SMS (or the template's email) with a `tpl?.body ?? ''`, and BECAUSE the member had a
// phone/email the send reached sendMessage with an empty body (calls=1). Post-fix the guard
// skips first (calls=0). If the member had no contact method, BOTH versions would short-circuit on
// `no_contact_method` (calls=0) and the test would be a false green — so we always give one.
const REACHABLE_MEMBER = { email: 'client@example.com', phone: '+15550100', full_name: 'Client Name' }

async function fire(engineKey, tplData, memberData = REACHABLE_MEMBER) {
  sendState.calls = 0
  sendState.approved = true
  const { db, captured } = makeDb(tplData, memberData)
  const ret = await impls[engineKey](db, cfg, { ...baseE }, 1, { ...touch }, dispatchCtx, NOW)
  return { ret, calls: sendState.calls, status: recordedStatus(captured) }
}

const results = []
function record(name, fn) {
  return fn().then(
    () => { results.push({ name, pass: true }); console.log(`  ✓ ${name}`) },
    (e) => { results.push({ name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) },
  )
}

for (const eng of engines) {
  console.log(`\n${eng.key} — fail closed on null / empty / invalid template`)

  await record(`${eng.key}: null template → skipped(template_unresolved), NO dispatch`, async () => {
    const r = await fire(eng.key, null)
    assert.equal(r.calls, 0, 'sendMessage must NEVER be called')
    // fireMessageTouch now returns a tri-state ('sent'|'blocked'|'deferred') so the tick
    // loop can hold the cursor on deferrals; a template skip is a terminal 'blocked'.
    assert.equal(r.ret, 'blocked', 'touch not sent (terminal skip, not a deferral)')
    assert.ok(r.status, 'an execution row was recorded')
    assert.equal(r.status.status, 'skipped')
    assert.equal(r.status.detail.reason, 'template_unresolved')
  })

  await record(`${eng.key}: whitespace body → skipped(template_body_empty), NO dispatch`, async () => {
    const r = await fire(eng.key, { channel: 'email', body: '   \n\t ', introduces_sender: false })
    assert.equal(r.calls, 0, 'sendMessage must NEVER be called')
    assert.equal(r.status.status, 'skipped')
    assert.equal(r.status.detail.reason, 'template_body_empty')
  })

  await record(`${eng.key}: invalid channel → skipped(template_channel_invalid), NO dispatch`, async () => {
    const r = await fire(eng.key, { channel: 'push', body: 'Hello there', introduces_sender: false })
    assert.equal(r.calls, 0, 'sendMessage must NEVER be called')
    assert.equal(r.status.status, 'skipped')
    assert.equal(r.status.detail.reason, 'template_channel_invalid')
  })

  await record(`${eng.key}: valid template → passes the guard and DOES dispatch`, async () => {
    const r = await fire(
      eng.key,
      { channel: 'email', body: 'Subject: Your review\n\nHello there — a quick note.', introduces_sender: false },
      { email: 'client@example.com', phone: '+15550100', full_name: 'Client Name' },
    )
    assert.equal(r.calls, 1, 'a valid template must reach sendMessage exactly once (guard does not over-block)')
    assert.notEqual(r.status && r.status.detail && r.status.detail.reason, 'template_unresolved')
    assert.notEqual(r.status && r.status.detail && r.status.detail.reason, 'template_body_empty')
    assert.notEqual(r.status && r.status.detail && r.status.detail.reason, 'template_channel_invalid')
  })
}

Module._load = origLoad

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) {
  console.error(`\n${failed.length} fail-closed assertion(s) FAILED — build-blocking.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} fail-closed proofs passed (F-2b: no engine dispatches an empty/defaulted body).`)
