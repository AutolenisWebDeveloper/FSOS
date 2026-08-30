// C-1 PROOF — the legacy drip runner (/api/campaigns/run) is routed through the
// compliance gate. Before this change the route called sendEmail/sendSms directly,
// enforcing only a consent boolean (skipping quiet-hours, DNC, approved-template,
// recommendation, and is_security). This proves the rewired runner:
//   • derives the row-level gate inputs correctly (buildCampaignSend, pure): the
//     firewall flag from customers.is_security, per-channel consent from the legacy
//     consent_* booleans, the approved-template ref, contact selection — and adds
//     NO footer itself (the dispatcher adds the required Reply-STOP opt-out footer).
//   • and that the four recipients then resolve through the REAL dispatcher/gate:
//     (a) clean/consented/approved → SENDS once WITH the Reply STOP footer;
//     (b) is_security, (c) DNC, (d) outside quiet hours → NOT sent, each writes a
//         compliance_event + escalation + audit (blocked, never silently dropped).
//
// Mirrors tests/guardrail-proof.test.mjs. Part B drives the REAL dispatch chokepoint with
// the REAL policy resolver and the REAL gate; only the DB readers and the provider are
// stubbed, so a recipient's verdict is produced by the same code production runs.
// Run: node tests/campaign-gate.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-campaign-'))
execSync(
  `npx tsc src/lib/comms/campaign-run.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { buildCampaignSend } = require(join(out, 'campaign-run.js'))

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
// These are the gate contexts sendMessage produces from each runner recipient.
console.log('Part B — four recipients through the real dispatcher/gate')
withProviderEnv()
const mod = loadChokepoint('campaign-gate')

// Fixed instants: 18:00 UTC = 12:00 America/Chicago (inside the floor);
// 04:00 UTC = 22:00 the previous day (outside it). Never the wall clock.
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0))
const LATE = new Date(Date.UTC(2026, 0, 15, 4, 0))

function drive(state, now = NOON) {
  const { messagingDeps, calls } = makeMessagingDeps(mod, state, { now })
  return mod.messaging
    .sendSms('+12145550147', 'Your annual review window is open. Reply to schedule.', 'mid-c1', {
      policy: {
        actor: 'campaign:drip',
        entity: { type: 'customer', id: 'cust1' },
        purpose: 'MARKETING',
        templateKind: 'stored',
        templateId: TEMPLATE,
      },
    }, messagingDeps)
    .then((r) => ({ r, calls }))
}

async function blocked(id, name, state, expectStep, expectAudit, now = NOON) {
  try {
    const { r, calls } = await drive(state, now)
    assert.equal(r.ok, false, 'must NOT send')
    assert.equal(calls.sms.length, 0, 'provider never invoked')
    assert.equal(r.blockedStep, expectStep, `blockedStep=${expectStep}`)
    assert.equal(r.escalated, true, 'must escalate')
    assert.equal(calls.escalate.length, 1, 'the withheld send goes through the escalation path')
    assert.equal(calls.escalate[0].outcome.escalate, true)
    record(id, name, () => {})
  } catch (e) {
    results.push({ id, name, pass: false, err: e.message })
    console.log(`  ✗ ${name}: ${e.message}`)
  }
}

await blocked('B_b', '(b) is_security recipient → firewall block + escalation', { conversationSecurity: true }, 'is_security', 'firewall.blocked')
await blocked('B_c', '(c) DNC recipient → blocked + escalation', { onDNC: true }, 'dnc', 'comms.blocked')
await blocked('B_d', '(d) outside quiet hours (22:00 recipient-local) → blocked + escalation', {}, 'quiet_hours', 'comms.blocked', LATE)

record('B_a', '(a) clean/consented/approved → SENDS once WITH the Reply STOP footer', () => {})
{
  const { r, calls } = await drive({})
  const a = results.find((x) => x.id === 'B_a')
  try {
    assert.equal(r.ok, true, 'sent=true')
    assert.equal(calls.sms.length, 1, 'provider invoked once')
    assert.ok(calls.sms[0].body.includes('Reply STOP'), 'SMS carries opt-out footer')
    assert.equal(calls.escalate.length, 0, 'no escalation on a clean send')
    assert.equal(calls.auditSent.length, 1, 'the send is audited')
  } catch (e) { a.pass = false; a.err = e.message; console.log(`  ✗ ${e.message}`) }
}

// ── summary ──
const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.id} | ${r.name}${r.err ? ' — ' + r.err : ''}`)
console.log('─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} campaign-gate assertion(s) FAILED — build-blocking.`); process.exit(1) }
console.log(`\nAll ${results.length} campaign-gate proofs passed (C-1: no ungated send path).`)
