// Final PROVIDER-BOUNDARY suppression re-check (dispatcher.ts). Proves the mandatory
// last-line guarantee: a message that PASSED the pure gate is still withheld if effective
// suppression flipped before the irreversible provider call — the "queued/retried while
// eligible, blocked before transmission" case. Uses injected deps (no DB / no provider).
//
// Run: node tests/comms-suppression-boundary.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-suppr-boundary-'))
execSync(
  `npx tsc src/lib/comms/dispatcher.ts src/lib/comms/gate.ts src/lib/comms/suppression.ts src/lib/comms/purpose.ts ` +
    `--rootDir src --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { dispatch } = require(join(out, 'lib/comms/dispatcher.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

// A gate context that PASSES the pure gate (clean, consented, approved, in-hours).
const cleanGate = {
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

function makeDeps(verify) {
  const calls = { audit: [], send: [], compliance: [], escalation: [] }
  const deps = {
    recordComplianceEvent: async (req, gate) => { calls.compliance.push({ req, gate }) },
    createEscalation: async (req, gate) => { calls.escalation.push({ req, gate }) },
    writeAudit: async (entry) => { calls.audit.push(entry) },
    verifyNotSuppressed: verify,
    send: async (channel, to, body) => { calls.send.push({ channel, to, body }); return { ok: true, id: 'prov_1' } },
  }
  return { deps, calls }
}

const baseReq = (extra = {}) => ({
  channel: 'sms',
  to: '+15550100',
  body: 'Your annual review window is open.',
  gate: cleanGate,
  actor: 'agent:pipeline',
  entity: { type: 'household', id: 'hh1' },
  ...extra,
})

console.log('dispatcher — final provider-boundary suppression re-check')

await t('gate PASSES but boundary re-check finds suppression → NOT sent, audited comms.suppressed', async () => {
  const { deps, calls } = makeDeps(async () => ({ suppressed: true, resolved: true, layer: 'agent_book', reason: 'agent blocked' }))
  const r = await dispatch(baseReq({ suppressionSubject: { agencyId: 'a1' } }), deps)
  assert.equal(r.sent, false)
  assert.equal(r.gate.blockedStep, 'suppression')
  assert.equal(r.escalated, false)
  assert.equal(calls.send.length, 0, 'provider MUST NOT be called')
  const supAudit = calls.audit.find((a) => a.action === 'comms.suppressed')
  assert.ok(supAudit, 'a comms.suppressed audit row is written')
  assert.equal(supAudit.diff.boundary, true)
  assert.equal(supAudit.diff.layer, 'agent_book')
})

await t('boundary re-check FAILS CLOSED (resolved=false) → NOT sent', async () => {
  const { deps, calls } = makeDeps(async () => ({ suppressed: true, resolved: false, layer: 'none', reason: 'lookup failed' }))
  const r = await dispatch(baseReq({ suppressionSubject: { contactId: 'c1' } }), deps)
  assert.equal(r.sent, false)
  assert.equal(r.gate.blockedStep, 'suppression')
  assert.equal(calls.send.length, 0)
})

await t('boundary re-check clears (not suppressed) → SENDS once with footer', async () => {
  const { deps, calls } = makeDeps(async () => ({ suppressed: false, resolved: true, layer: 'none' }))
  const r = await dispatch(baseReq({ suppressionSubject: { contactId: 'c1' } }), deps)
  assert.equal(r.sent, true)
  assert.equal(calls.send.length, 1)
  assert.match(calls.send[0].body, /Reply STOP/i, 'SMS opt-out footer appended after the boundary check')
})

await t('no subject (transactional/internal) → boundary check SKIPPED, sends normally', async () => {
  let verifyCalled = false
  const { deps, calls } = makeDeps(async () => { verifyCalled = true; return { suppressed: true, resolved: true, layer: 'agent_book' } })
  const r = await dispatch(baseReq(), deps) // no suppressionSubject
  assert.equal(r.sent, true)
  assert.equal(verifyCalled, false, 'verifyNotSuppressed must NOT run without a subject')
  assert.equal(calls.send.length, 1)
})

console.log(`\n✓ suppression boundary: ${passed} cases passed`)
