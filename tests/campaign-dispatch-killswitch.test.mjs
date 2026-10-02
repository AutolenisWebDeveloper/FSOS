// campaign-dispatch honours the kill switches, and a drip never silently completes (audit C-05,
// C-01). Drives the REAL handlers.ts (esbuild-bundled) against the scripted fake DB.
//   • C-05: the marketing_automation agent switch and the global gateway switch had no runtime
//     reader — turning them off halted nothing. Off (or unreadable) → no campaign read, no send.
//   • C-01: a drip whose sequence is not active (or unreadable) HOLDS its enrollments; it used to
//     mark every one 'completed' without a single send.
// Run: node tests/campaign-dispatch-killswitch.test.mjs
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-cd-ks-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const gatewayStub = join(dir, 'gateway.mjs')
writeFileSync(gatewayStub, `
export class GatewayDisabledError extends Error {}
export async function runGateway() { throw new Error('model calls are not part of this test') }
export async function runGatewayTools() { throw new Error('model calls are not part of this test') }
export async function assertKillSwitch(agentKey) {
  const s = globalThis.__ks ?? { global: true, agent: true }
  if (s.throws) throw new Error('read failed')
  if (!s.global) throw new Error('AI gateway disabled by kill switch (global).')
  if (agentKey && !s.agent) throw new Error('AI gateway disabled by kill switch (agent:' + agentKey + ').')
}
`)
const a2pStub = join(dir, 'a2p.mjs')
writeFileSync(a2pStub, 'export function smsA2pApproved() { return true }\n')
const h = await bundle('src/jobs/handlers.ts', { aliases: { '@/lib/ai/gateway': gatewayStub, '@/lib/comms/a2p': a2pStub } })

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const campaignReads = (db) => db.calls.filter((c) => c.table === 'comm_campaigns' || c.table === 'comm_campaign_enrollments')

console.log('campaign-dispatch honours the kill switches (C-05)')
for (const [label, ks] of [['marketing_automation agent off', { global: true, agent: false }], ['global gateway off', { global: false, agent: true }], ['switch unreadable', { throws: true }]]) {
  await t(`${label} → halted, nothing read or sent`, async () => {
    globalThis.__ks = ks
    const db = installDb(fakeDb({}))
    const r = await h.campaignDispatch()
    assert.equal(r.handled, 0)
    assert.match(r.note, /halted/)
    assert.equal(campaignReads(db).length, 0)
  })
}
await t('both on → it proceeds to read the active campaigns', async () => {
  globalThis.__ks = { global: true, agent: true }
  const db = installDb(fakeDb({ comm_campaigns: [[]], comm_campaign_enrollments: [[]] }))
  const r = await h.campaignDispatch()
  assert.doesNotMatch(r.note, /halted/)
  assert.ok(db.calls.some((c) => c.table === 'comm_campaigns'))
})

console.log('\nA drip on a non-active sequence holds (C-01)')
const enrollment = (over = {}) => ({
  id: 'e1', campaign_id: 'c1', member_id: 'm1', household_id: 'h1', agency_id: null, current_step: 0,
  next_send_at: '2026-01-01T00:00:00Z',
  comm_campaigns: { id: 'c1', type: 'drip', channel: 'email', sequence_id: 's1', status: 'active', archived_at: null, purpose: 'MARKETING', represented_agency_owner_id: null, delegation_id: null, claim_fields: null },
  ...over,
})
const completions = (db) => db.calls.filter((c) => c.table === 'comm_campaign_enrollments' && c.method === 'update' && c.payload?.status === 'completed')
for (const [label, seq] of [['draft sequence', { steps: [{ delay_days: 0 }], status: 'draft', purpose: null }], ['unreadable sequence', { __error: { message: 'timeout' } }], ['missing sequence', null]]) {
  await t(`${label} → the enrollment is NOT completed`, async () => {
    const db = installDb(fakeDb({ comm_campaign_enrollments: [[enrollment()]], comm_sequences: [seq] }))
    await h.dripAdvance()
    assert.equal(completions(db).length, 0)
  })
}
await t('an active sequence whose steps are all done still completes', async () => {
  const db = installDb(fakeDb({ comm_campaign_enrollments: [[enrollment({ current_step: 1 })]], comm_sequences: [{ steps: [{ delay_days: 0 }], status: 'active', purpose: null }] }))
  await h.dripAdvance()
  assert.equal(completions(db).length, 1)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
