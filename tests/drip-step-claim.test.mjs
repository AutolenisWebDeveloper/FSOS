// Follow-up R12b: a drip step is claimed before it is sent. The cursor update used to run AFTER the
// send, unchecked — a run that timed out after the provider accepted the message left the cursor
// behind, and the next run sent the same step again. Now the step is claimed by advancing the cursor
// with a compare-and-set first; a deferral (a self-clearing hold) rolls the claim back.
// Run: node tests/drip-step-claim.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r12b-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const sendStub = join(dir, 'send.mjs')
writeFileSync(sendStub, `export async function sendMessage(ctx) {
  (globalThis.__sends ??= []).push(ctx)
  const mode = globalThis.__mode
  if (mode === 'timeout') throw new Error('function timed out after the provider accepted the message')
  if (mode === 'defer') return { sent: false, blocked: true, gate: { allowed: false, blockedStep: 'frequency' } }
  return { sent: true, blocked: false, gate: { allowed: true } }
}
export async function isTemplateApproved() { return true }`)
const a2pStub = join(dir, 'a2p.mjs')
writeFileSync(a2pStub, `export function smsA2pApproved() { return true }\nexport function smsLiveFor() { return true }`)
const handlers = await bundle('src/jobs/handlers.ts', { aliases: { '@/lib/comms/send': sendStub, '@/lib/comms/a2p': a2pStub } })

const PAST = new Date(Date.now() - 3600_000).toISOString()
function seed() {
  const db = memDb(); installDb(db)
  db.seed('comm_campaigns', [{ id: 'camp-1', type: 'drip', channel: 'email', sequence_id: 'seq-1', status: 'active', archived_at: null, purpose: 'MARKETING' }])
  db.seed('comm_sequences', [{ id: 'seq-1', status: 'active', purpose: 'MARKETING', steps: [{ delay_days: 0, template_id: 'tpl-1', subject: 'One' }, { delay_days: 3, template_id: 'tpl-2', subject: 'Two' }] }])
  db.seed('comm_templates', [{ id: 'tpl-1', body: 'Step one' }, { id: 'tpl-2', body: 'Step two' }])
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', email: 'pat@example.com', full_name: 'Pat' }])
  db.seed('comm_campaign_enrollments', [{ id: 'enr-1', campaign_id: 'camp-1', member_id: 'm1', household_id: 'h1', agency_id: null, status: 'enrolled', current_step: 0, next_send_at: PAST }])
  return db
}

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Drip steps are claimed before they are sent')
await t('a run that dies after the provider accepted the step never sends it again', async () => {
  const db = seed(); globalThis.__sends = []
  globalThis.__mode = 'timeout'
  try { await handlers.dripAdvance() } catch { /* the run died */ }
  globalThis.__mode = 'sent'
  await handlers.dripAdvance()
  const stepZero = globalThis.__sends.filter((c) => c.sequenceStep === 0)
  assert.equal(stepZero.length, 1, `step 0 was sent ${stepZero.length} times`)
  assert.equal(db.rows('comm_campaign_enrollments')[0].current_step, 1)
})
await t('a deferral rolls the claim back: the same step is re-attempted, never skipped', async () => {
  const db = seed(); globalThis.__sends = []
  globalThis.__mode = 'defer'
  await handlers.dripAdvance()
  assert.equal(db.rows('comm_campaign_enrollments')[0].current_step, 0, 'a held step was burned')
  globalThis.__mode = 'sent'
  await handlers.dripAdvance()
  assert.equal(globalThis.__sends.filter((c) => c.sequenceStep === 0).length, 2, 'held, then sent')
  assert.equal(db.rows('comm_campaign_enrollments')[0].current_step, 1)
})
await t('two overlapping runs send a step once', async () => {
  const db = seed(); globalThis.__sends = []
  globalThis.__mode = 'sent'
  await Promise.all([handlers.dripAdvance(), handlers.dripAdvance()])
  assert.equal(globalThis.__sends.filter((c) => c.sequenceStep === 0).length, 1)
  void db
})
console.log(`\nAll ${passed} assertions passed.`)
