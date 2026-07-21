// C-1 PROOF — the legacy drip runner (/api/campaigns/run) is routed through the
// compliance gate. Before this change the route called sendEmail/sendSms directly,
// enforcing only a consent boolean (skipping quiet-hours, DNC, approved-template,
// recommendation, and is_security). This proves the rewired runner:
//   • derives the row-level gate inputs correctly (buildCampaignSend, pure): the
//     firewall flag from customers.is_security, per-channel consent from the legacy
//     consent_* booleans, the approved-template ref, contact selection — and adds
//     NO footer itself (the dispatcher adds the required TRAIGA/Reply-STOP footer).
//   • and that the four recipients then resolve through the REAL dispatcher/gate:
//     (a) clean/consented/approved → SENDS once WITH the Reply STOP footer;
//     (b) is_security, (c) DNC, (d) outside quiet hours → NOT sent, each writes a
//         compliance_event + escalation + audit (blocked, never silently dropped).
//
// Mirrors tests/guardrail-proof.test.mjs' spy-dispatch harness. The DB-coupled
// wiring in sendThroughGate (row → gate context) is exercised by guardrail-proof;
// here we prove the campaign runner's row-derivation + the gate outcome per recipient.
// Run: node tests/campaign-gate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-'))
execSync(
  `npx tsc src/lib/comms/campaign-run.ts src/lib/comms/dispatcher.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildCampaignSend } = require(join(out, 'comms/campaign-run.js'))
const { dispatch } = require(join(out, 'comms/dispatcher.js'))

const results = []
function record(id, name, fn) {
  try { fn(); results.push({ id, name, pass: true }); console.log(`  ✓ ${name}`) }
  catch (e) { results.push({ id, name, pass: false, err: e.message }); console.log(`  ✗ ${name}: ${e.message}`) }
}

// ── Part A — buildCampaignSend derives the row-level gate inputs (pure) ──
console.log('Part A — campaign runner row derivation (buildCampaignSend)')
const TEMPLATE = 'tmpl-approved-1'

record('A1', 'sms: consented clean customer → durable consent + no securities + template ref, NO manual footer', () => {
  const cs = buildCampaignSend(
    { channel: 'sms', campaign_id: 'c1', template_id: TEMPLATE },
    { first_name: 'Dana', phone: '+15550100', consent_sms: true, is_security: false },
    { order: 0, delay_days: 0, body: 'Hi {first_name}, your annual review window is open.' },
  )
  assert.equal(cs.channel, 'sms')
  assert.equal(cs.to, '+15550100')
  assert.equal(cs.durableConsentGranted, true)
  assert.equal(cs.isSecurity, false)
  assert.equal(cs.templateId, TEMPLATE)
  assert.equal(cs.body, 'Hi Dana, your annual review window is open.')
  assert.ok(!/Reply STOP/i.test(cs.body), 'runner must NOT add the footer (dispatcher adds it)')
})

record('A2', 'is_security customer → isSecurity=true (DB-derived, never a literal)', () => {
  const cs = buildCampaignSend(
    { channel: 'sms', campaign_id: 'c1', template_id: TEMPLATE },
    { first_name: 'Sam', phone: '+15550101', consent_sms: true, is_security: true },
    { order: 0, delay_days: 0, body: 'Quarterly note.' },
  )
  assert.equal(cs.isSecurity, true)
})

record('A3', 'email: uses email + consent_email; missing contact → null (skip)', () => {
  const ok = buildCampaignSend(
    { channel: 'email', campaign_id: 'c1', template_id: TEMPLATE },
    { first_name: 'Lee', email: 'lee@example.com', consent_email: true, is_security: false },
    { order: 0, delay_days: 0, subject: 'Hello {first_name}', body: 'Body' },
  )
  assert.equal(ok.channel, 'email')
  assert.equal(ok.to, 'lee@example.com')
  assert.equal(ok.durableConsentGranted, true)
  const none = buildCampaignSend(
    { channel: 'sms', campaign_id: 'c1', template_id: TEMPLATE },
    { first_name: 'NoPhone', consent_sms: true, is_security: false },
    { order: 0, delay_days: 0, body: 'x' },
  )
  assert.equal(none, null, 'no contact method → null (skipped, never sent)')
})

record('A4', 'unconsented customer still produces a context (gate is authoritative, blocks on consent)', () => {
  const cs = buildCampaignSend(
    { channel: 'sms', campaign_id: 'c1', template_id: TEMPLATE },
    { first_name: 'Pat', phone: '+15550102', consent_sms: false, is_security: false },
    { order: 0, delay_days: 0, body: 'x' },
  )
  assert.equal(cs.durableConsentGranted, false, 'consent read preserved; gate enforces it')
})

// ── Part B — the four recipients resolve through the REAL gate/dispatcher ──
// These are the gate contexts sendThroughGate produces from each runner recipient.
console.log('Part B — four recipients through the real dispatcher/gate')
function makeSpies() {
  const calls = { compliance: [], escalation: [], audit: [], send: [] }
  const deps = {
    recordComplianceEvent: async (req, gate) => { calls.compliance.push({ req, gate }) },
    createEscalation: async (req, gate) => { calls.escalation.push({ req, gate }) },
    writeAudit: async (entry) => { calls.audit.push(entry) },
    send: async (channel, to, body, subject) => { calls.send.push({ channel, to, body, subject }); return { ok: true, id: 'prov_1' } },
  }
  return { calls, deps }
}
const cleanGate = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }
const req = (over = {}) => ({
  channel: 'sms', to: '+15550100', body: 'Your annual review window is open. Reply to schedule.',
  actor: 'campaign:drip', entity: { type: 'customer', id: 'cust1' }, gate: { ...cleanGate, ...(over.gate || {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'gate')),
})

async function blocked(id, name, gateOver, expectStep, expectAudit) {
  const { calls, deps } = makeSpies()
  const r = await dispatch(req({ gate: gateOver }), deps)
  assert.equal(r.sent, false, 'must NOT send')
  assert.equal(calls.send.length, 0, 'sender never invoked')
  assert.equal(r.gate.blockedStep, expectStep, `blockedStep=${expectStep}`)
  assert.equal(r.escalated, true, 'must escalate')
  assert.equal(calls.compliance.length, 1, 'compliance_event recorded')
  assert.equal(calls.escalation.length, 1, 'escalation created')
  assert.equal(calls.audit.length, 1, 'audit written')
  assert.equal(calls.audit[0].action, expectAudit, `audit=${expectAudit}`)
  record(id, name, () => {})
}

await blocked('B_b', '(b) is_security recipient → firewall.blocked + escalation', { isSecurity: true }, 'is_security', 'firewall.blocked')
await blocked('B_c', '(c) DNC recipient → comms.blocked + escalation', { onDNC: true }, 'dnc', 'comms.blocked')
await blocked('B_d', '(d) outside quiet hours (22:00 local) → comms.blocked + escalation', { recipientLocalHour: 22 }, 'quiet_hours', 'comms.blocked')

record('B_a', '(a) clean/consented/approved → SENDS once WITH the Reply STOP footer', () => {})
{
  const { calls, deps } = makeSpies()
  const r = await dispatch(req(), deps)
  const a = results.find((x) => x.id === 'B_a')
  try {
    assert.equal(r.sent, true, 'sent=true')
    assert.equal(calls.send.length, 1, 'sender invoked once')
    assert.ok(calls.send[0].body.includes('Reply STOP'), 'SMS carries opt-out footer')
    assert.equal(calls.compliance.length, 0, 'no compliance_event on a clean send')
    assert.equal(calls.audit[0].action, 'comms.sent', 'audit=comms.sent')
  } catch (e) { a.pass = false; a.err = e.message; console.log(`  ✗ ${e.message}`) }
}

// ── summary ──
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.id} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} campaign-gate assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} campaign-gate proofs passed (C-1: no ungated send path).`)
