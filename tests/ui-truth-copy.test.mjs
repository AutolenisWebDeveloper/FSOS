// UI TRUTH — surfaces may only claim what the runtime does (audit I-04…I-24, E-05, E-16–E-18).
// Source-level pins for the copy this audit corrected (no render harness exists for these server
// pages), the workflow-enable refusal, and the pure run-state read model the status surfaces use.
// Run: node tests/ui-truth-copy.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, fakeDb, installDb, makeReq } from './helpers/workshop-harness.mjs'

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const src = (p) => readFileSync(p, 'utf8')

console.log('False automation claims are gone')
const GONE = [
  ['src/app/(fsa)/app/comms/pipeline-winback/[id]/page.tsx', /These fire on events/],
  ['src/app/(fsa)/app/comms/cross-sell-life/[id]/page.tsx', /AI conversation engine grounds on/],
  ['src/app/(fsa)/app/reports/scheduled/page.tsx', /emails the exported file to its recipients/],
  ['src/app/(super)/super/webhooks/page.tsx', /Delivery attempts appear here once events fire/],
  ['src/app/(admin)/admin/data/exports/page.tsx', /then “ready” once the file is built/],
  ['src/app/(fsa)/app/comms/delivery/page.tsx', /Failed sends retry idempotently/],
  ['src/app/(fsa)/app/conversions/monitoring/page.tsx', /Educational outreach activity/],
  ['src/app/(fsa)/app/cross-sell/page.tsx', /Households contacted/],
  ['src/components/app/OutreachActions.tsx', /'Send education'|'Invite to review'/],
  ['src/components/app/CampaignEngineControls.tsx', /Send the next due touch now/],
  ['src/app/(fsa)/app/winback/page.tsx', /title="AI outreach"/],
  ['src/app/(fsa)/app/workflows/page.tsx', /Event-driven automation for internal tasks/],
  ['src/components/app/WorkflowBuilder.tsx', /Enable it when ready/],
]
for (const [file, re] of GONE) await t(`${file.split('/app/').pop()}: no "${re.source.slice(0, 40)}"`, () => assert.doesNotMatch(src(file), re))
await t('/super/jobs lists the registry, not a hard-coded subset', () => {
  const s = src('src/app/(super)/super/jobs/page.tsx')
  assert.match(s, /AUTOMATIONS\.filter/)
  assert.doesNotMatch(s, /const jobNames = \[/)
})
await t('env-var presence reads "configured", never "connected"', () => {
  for (const f of ['src/app/(super)/super/integrations/page.tsx', 'src/app/(super)/super/health/page.tsx']) {
    assert.doesNotMatch(src(f), /(twilio|email|ai) \? 'connected'/, f)
  }
})

console.log('\nWorkflows cannot be enabled (no executor)')
const wfRoute = await bundle('src/app/api/workflows/[id]/route.ts', { aliases: { '@/lib/auth/api': await (async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const d = mkdtempSync(join(tmpdir(), 'fsos-uitruth-')); const p = join(d, 'auth.mjs')
  writeFileSync(p, `export async function requireApiRole() { return { ok: true, session: { role: 'fsa' } } }\nexport function requirePermission() { return null }\nexport function actorOf() { return 'fsa:u1' }\n`)
  return p
})() } })
const patch = (body) => wfRoute.PATCH(makeReq('/api/workflows/w1', { method: 'PATCH', body, headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ id: 'w1' }) })
await t('PATCH enabled:true → 409 and nothing written', async () => {
  const db = installDb(fakeDb({}))
  const res = await patch({ enabled: true })
  assert.equal(res.status, 409)
  assert.equal(db.calls.filter((c) => c.method === 'update').length, 0)
})
await t('PATCH enabled:false still disables', async () => {
  const db = installDb(fakeDb({ automation_workflows: [{ id: 'w1', enabled: false }] }))
  const res = await patch({ enabled: false })
  assert.equal(res.status, 200)
  assert.equal(db.calls.find((c) => c.method === 'update').payload.enabled, false)
})

console.log('\nRun state from execution evidence (automation-status.ts)')
const st = await bundle('src/lib/ops/automation-status.ts')
const NOW = Date.parse('2026-10-02T18:00:00Z')
await t('completed recently → succeeded; errored → failed; old → stale; none → none', () => {
  assert.equal(st.runState({ status: 'completed', started_at: '2026-10-02T15:00:00Z', finished_at: '2026-10-02T15:01:00Z' }, NOW), 'succeeded')
  assert.equal(st.runState({ status: 'errored', started_at: '2026-10-02T15:00:00Z' }, NOW), 'failed')
  assert.equal(st.runState({ status: 'completed', started_at: '2026-09-30T15:00:00Z', finished_at: '2026-09-30T15:01:00Z' }, NOW), 'stale')
  assert.equal(st.runState({ status: 'running', started_at: '2026-10-02T17:59:00Z' }, NOW), 'running')
  assert.equal(st.runState(null, NOW), 'none')
})
await t('a completed run is green, a failed one red (it used to render both amber)', () => {
  assert.equal(st.RUN_STATE_DOT.succeeded, 'bg-status-won')
  assert.equal(st.RUN_STATE_DOT.failed, 'bg-status-lost')
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
