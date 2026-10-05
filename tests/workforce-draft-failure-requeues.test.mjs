// Review of R12c: R12c counts a 'drafted' (claimed, outcome unknown) row as touched, so a run that
// died after it may have sent never sends again. But a failure BEFORE any send — the AI draft call
// throwing (provider outage) — also left the row 'drafted' forever, and the referral was never
// contacted. A draft failure now releases the row as held ('draft_failed'): nothing was sent, the
// hold expires (expireStaleHolds), and the next day's build re-queues the referral.
// Run: node tests/workforce-draft-failure-requeues.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fsos-r12c-draft-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const stub = (name, src) => { const p = join(dir, name); writeFileSync(p, src); return p }
const aliases = {
  '@/jobs/agent-runner': stub('runner.mjs', `export async function runAgent({ work }) {
    const ctx = { runId: 'run-1', setConfidence() {}, async escalate() {}, async recordAction() {},
      async gateway() { throw new Error('provider outage') } }
    try { await work(ctx); return { status: 'completed', runId: 'run-1' } } catch (e) { return { status: 'errored', runId: 'run-1', reason: e.message } }
  }`),
  '@/lib/comms/hours': stub('hours.mjs', 'export async function isWithinOperatingHours() { return true }'),
  '@/lib/comms/suppression': stub('supp.mjs', 'export async function resolveEffectiveSuppression() { return { suppressed: false, resolved: true } }'),
  '@/lib/knowledge/library': stub('kb.mjs', 'export async function searchKnowledge() { return [] }\nexport function renderKnowledgeContext() { return "" }'),
  '@/lib/comms/send': stub('send.mjs', 'export async function sendMessage() { globalThis.__sent = (globalThis.__sent ?? 0) + 1; return { sent: true, gate: { allowed: true } } }'),
}
const wf = await bundle('src/lib/ai/workforce.ts', { aliases })

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('A failed AI draft does not strand a referral')
await t('the row is released as held, not left drafted, and the referral is not counted as touched', async () => {
  const db = memDb(); installDb(db)
  const today = new Date().toISOString().slice(0, 10)
  db.seed('agent_daily_targets', [{ agent_key: 'referral_followup', daily_target: 5, channel: 'email', enabled: true }])
  db.seed('households', [{ id: 'h1', do_not_contact: false }])
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', email: 'pat@example.com', full_name: 'Pat' }])
  db.seed('outreach_queue', [{ id: 'q1', queue_date: today, agent_key: 'referral_followup', source: 'referral_followup', entity_type: 'referral', entity_id: 'ref-1', household_id: 'h1', member_id: 'm1', channel: 'email', status: 'queued', priority: 1 }])
  const s = await wf.runOutreachAgent('referral_followup')
  const row = db.rows('outreach_queue').find((r) => r.id === 'q1')
  assert.equal(globalThis.__sent ?? 0, 0, 'nothing was sent')
  assert.equal(row.status, 'held', `row left ${row.status}`)
  assert.match(row.block_reason ?? '', /draft_failed/)
  assert.equal(await wf.referralAlreadyTouched('ref-1'), false)
  assert.equal(s.errored, 'provider outage', 'the run is still reported errored (R17b)')
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
