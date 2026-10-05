// Follow-up R17: the status UI must not say a run is fine when it is not.
//  a. a run still 'running' past the job lease was hard-killed (serverless timeout) → Timed out.
//  b. a halted run (campaign-dispatch kill switch) or an internally failed one (a retry sweep that
//     could not read its queue, a workforce agent run that errored) recorded 'completed' and showed
//     Succeeded. The job now reports it, and the run is recorded halted / errored.
// Run: node tests/automation-run-state.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const st = await bundle('src/lib/ops/automation-status.ts')
const NOW = Date.parse('2026-10-05T18:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Run state from execution evidence')

await t('a: running inside the lease → Running', () => {
  assert.equal(st.runState({ status: 'running', started_at: ago(2) }, NOW), 'running')
})
await t('a: running past the job lease → Timed out (not Running)', () => {
  const s = st.runState({ status: 'running', started_at: ago(60) }, NOW)
  assert.equal(s, 'timed_out')
  assert.equal(st.RUN_STATE_LABEL[s], 'Timed out')
  assert.equal(st.RUN_STATE_DOT[s], 'bg-status-lost')
})

await t('b: a completed run that recorded a halt → Halted (not Succeeded)', () => {
  const s = st.runState({ status: 'completed', started_at: ago(5), finished_at: ago(4), error: 'halted: kill switch' }, NOW)
  assert.equal(s, 'halted')
  assert.equal(st.RUN_STATE_LABEL[s], 'Halted')
})

const jobs = await bundle('src/jobs/index.ts')
await t('b: the job outcome maps ok:false → errored and halted → a recorded halt', () => {
  assert.deepEqual(jobs.jobRunOutcome({ ok: true, note: 'fine' }), { status: 'completed', error: null })
  assert.deepEqual(jobs.jobRunOutcome({ ok: false, note: 'read failed' }), { status: 'errored', error: 'read failed' })
  assert.deepEqual(jobs.jobRunOutcome({ ok: true, halted: true, note: 'kill switch' }), { status: 'completed', error: 'halted: kill switch' })
})

const runtime = await bundle('src/lib/jobs/runtime.ts')
await t('a: the timed-out threshold is the job lease runIdempotent reclaims after', () => {
  assert.equal(st.RUN_LEASE_MS, runtime.JOB_LEASE_MS)
})
await t('b: runIdempotent records the settled outcome on job_runs', async () => {
  const db = memDb(); installDb(db)
  await runtime.runIdempotent('a:1', 'a', async () => ({ ok: false, note: 'boom' }), { settle: jobs.jobRunOutcome })
  await runtime.runIdempotent('b:1', 'b', async () => ({ ok: true, halted: true, note: 'switch off' }), { settle: jobs.jobRunOutcome })
  await runtime.runIdempotent('c:1', 'c', async () => ({ ok: true }), { settle: jobs.jobRunOutcome })
  const row = (k) => db.rows('job_runs').find((r) => r.dedupe_key === k)
  assert.equal(row('a:1').status, 'errored'); assert.equal(row('a:1').error, 'boom')
  assert.equal(row('b:1').status, 'completed'); assert.equal(row('b:1').error, 'halted: switch off')
  assert.equal(row('c:1').status, 'completed'); assert.equal(row('c:1').error ?? null, null)
})

const dir = mkdtempSync(join(tmpdir(), 'fsos-r17b-'))
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ } })
const handlers = await bundle('src/jobs/handlers.ts')
await t('b: campaign-dispatch halted by the kill switch reports halted', async () => {
  // No switch rows: an unreadable / absent switch is off (fail closed), so the run halts.
  installDb(memDb())
  const r = await handlers.campaignDispatch()
  assert.equal(r.halted, true)
  assert.equal(jobs.jobRunOutcome(r).error.startsWith('halted:'), true)
})

for (const [name, file, table] of [
  ['Life', 'src/lib/life-campaign/jobs.ts', 'life_campaign_executions'],
  ['Win-Back', 'src/lib/pipeline-winback/jobs.ts', 'pipeline_winback_executions'],
  ['Cross-Sell', 'src/lib/cross-sell-life/jobs.ts', 'xsell_life_campaign_executions'],
  ['District nurture', 'src/lib/district-nurture/jobs.ts', 'district_nurture_executions'],
]) {
  const mod = await bundle(file)
  await t(`b: ${name} retry sweep that cannot read its queue reports ok:false`, async () => {
    installDb(memDb({ failOn: (q) => q.table === table && q.method === 'select' }))
    const r = await mod.runRetrySweep()
    assert.equal(r.ok, false, r.note)
  })
}

const runnerStub = join(dir, 'agent-runner.mjs')
writeFileSync(runnerStub, 'export async function runAgent() { return { status: "errored", runId: "run-1", reason: "gateway exploded" } }')
const hoursStub = join(dir, 'hours.mjs')
writeFileSync(hoursStub, 'export async function isWithinOperatingHours() { return true }')
const wf = await bundle('src/lib/ai/workforce.ts', { aliases: { '@/jobs/agent-runner': runnerStub, '@/lib/comms/hours': hoursStub } })
await t('b: a workforce agent run that errored is reported, not swallowed', async () => {
  const db = memDb(); installDb(db)
  const today = new Date().toISOString().slice(0, 10)
  db.seed('agent_daily_targets', [{ agent_key: 'referral_followup', daily_target: 5, channel: 'email', enabled: true }])
  db.seed('outreach_queue', [{ id: 'q1', queue_date: today, agent_key: 'referral_followup', entity_type: 'referral', entity_id: 'ref-1', status: 'queued', priority: 1 }])
  const s = await wf.runOutreachAgent('referral_followup')
  assert.equal(s.errored, 'gateway exploded')
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
