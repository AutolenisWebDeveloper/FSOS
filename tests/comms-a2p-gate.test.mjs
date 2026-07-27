// Three-life-campaigns launch, Slice 7 (§12) — A2P 10DLC SMS staging gate.
// Proves offline that SMS is HELD (never sent) until the A2P flag flips, that the hold is a
// non-escalating deferral that never masks a real compliance block, and that email is never
// A2P-gated. Run: node tests/comms-a2p-gate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-a2p-'))
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/comms/a2p.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { smsA2pApproved, smsLiveFor } = require(join(out, 'comms/a2p.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// A compliance-clean SMS context (everything else passes) so `sms_live` is the only variable.
const cleanSms = {
  draft: 'Hi {{first_name}} — quick note from your Farmers agency about your annual review.',
  channel: 'sms',
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

console.log('gate — sms_live A2P hold')

t('SMS with smsLive=false is HELD (blocked sms_live, non-escalating)', () => {
  const r = evaluateGate({ ...cleanSms, smsLive: false })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'sms_live')
  assert.equal(r.escalate, false, 'a go-live hold is operational, never a compliance escalation')
  assert.match(r.reason, /A2P/i)
})

t('SMS with smsLive=true sends (gate allows)', () => {
  const r = evaluateGate({ ...cleanSms, smsLive: true })
  assert.equal(r.allowed, true)
})

t('smsLive omitted defaults to allowed (email + existing callers unaffected)', () => {
  const r = evaluateGate({ ...cleanSms, channel: 'email' })
  assert.equal(r.allowed, true)
})

t('an escalating compliance block WINS over the A2P hold (never masked)', () => {
  // Securities-flagged SMS while staged → must surface as the firewall block (escalating),
  // not as the benign non-escalating A2P hold.
  const r = evaluateGate({ ...cleanSms, isSecurity: true, smsLive: false })
  assert.equal(r.blockedStep, 'is_security')
  assert.equal(r.escalate, true)
})

t('no-consent SMS while staged still surfaces the consent block first', () => {
  const r = evaluateGate({ ...cleanSms, hasConsent: false, smsLive: false })
  assert.equal(r.blockedStep, 'consent')
  assert.equal(r.escalate, true)
})

console.log('a2p — the single go-live flag')

const orig = process.env.SMS_A2P_APPROVED
const setFlag = (v) => { if (v === undefined) delete process.env.SMS_A2P_APPROVED; else process.env.SMS_A2P_APPROVED = v }

t('defaults to NOT approved (staged) when unset', () => {
  setFlag(undefined)
  assert.equal(smsA2pApproved(), false)
})

t('recognizes true / 1 / yes (case-insensitive) as approved', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'Yes']) { setFlag(v); assert.equal(smsA2pApproved(), true, v) }
})

t('anything else is NOT approved (fails safe)', () => {
  for (const v of ['false', '0', 'no', '', 'approved-soon']) { setFlag(v); assert.equal(smsA2pApproved(), false, JSON.stringify(v)) }
})

t('smsLiveFor: email is never A2P-gated; SMS tracks the flag', () => {
  setFlag(undefined)
  assert.equal(smsLiveFor('email'), true, 'email always live even when SMS is staged')
  assert.equal(smsLiveFor('sms'), false, 'SMS held while staged')
  setFlag('true')
  assert.equal(smsLiveFor('sms'), true, 'SMS live once approved')
})

setFlag(orig)
console.log(`\n✅ comms-a2p-gate: ${passed} passed`)
