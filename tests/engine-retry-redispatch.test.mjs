// The campaign retry sweeps resolve an ORPHANED message claim from its message of record (audit
// D-07 / E-10 / H-11 / J-06) instead of only bumping attempts until it dead-letters:
//   • a message row with sent_at → the execution is reconciled to 'sent' (no re-send);
//   • no message row → released for the tick to re-attempt ONLY with engine_retry_redispatch ON
//     (off by default — the seeded state — and canary behaves as off for this consumer);
//   • queued / blocked / unreadable → unchanged (backoff + dead-letter as before);
//   • advisor tasks are never touched.
// Drives the real orphan-executions.ts and all four real jobs.ts sweeps (esbuild, fake DB).
// Run: node tests/engine-retry-redispatch.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

const orphan = await bundle('src/lib/ops/orphan-executions.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const X = { id: 'x1', enrollment_id: 'e1', touch_no: 3, kind: 'sms' }
const calls = (db, table, method) => db.calls.filter((c) => c.table === table && c.method === method)

console.log('classifyOrphan (pure)')
await t('sent / never dispatched / ambiguous', () => {
  assert.equal(orphan.classifyOrphan([{ sent_at: '2026-10-02T15:00:00Z' }], false), 'sent')
  assert.equal(orphan.classifyOrphan([], false), 'never_dispatched')
  assert.equal(orphan.classifyOrphan([{ sent_at: null }], false), 'ambiguous', 'a queued/blocked row may have reached the provider')
  assert.equal(orphan.classifyOrphan(null, true), 'ambiguous')
})

console.log('\nresolveOrphanExecution')
await t('a send that went out is reconciled to sent, never re-sent', async () => {
  const db = fakeDb({ comm_messages: [[{ id: 'm1', sent_at: '2026-10-02T15:00:00Z' }]] })
  assert.equal(await orphan.resolveOrphanExecution(db, 'life_campaign_executions', 'life_campaign_enrollment', X), 'reconciled_sent')
  assert.equal(calls(db, 'life_campaign_executions', 'update')[0].payload.status, 'sent')
  assert.equal(calls(db, 'life_campaign_executions', 'delete').length, 0)
})
for (const [label, sw] of [['switch row absent', null], ['switch off', { mode: 'off' }], ['switch canary', { mode: 'canary' }], ['switch unreadable', { __error: { message: 'x' } }]]) {
  await t(`never dispatched + ${label} → unchanged (nothing released)`, async () => {
    const db = installDb(fakeDb({ comm_messages: [[]], automation_switches: [sw] }))
    assert.equal(await orphan.resolveOrphanExecution(db, 'life_campaign_executions', 'life_campaign_enrollment', X), 'unchanged')
    assert.equal(calls(db, 'life_campaign_executions', 'delete').length, 0)
  })
}
await t('never dispatched + switch ON → the claim is released for the tick to re-attempt', async () => {
  const db = installDb(fakeDb({ comm_messages: [[]], automation_switches: [{ mode: 'on' }] }))
  assert.equal(await orphan.resolveOrphanExecution(db, 'life_campaign_executions', 'life_campaign_enrollment', X), 'released')
  const del = calls(db, 'life_campaign_executions', 'delete')[0]
  assert.ok(del.filters.some(([o, c, v]) => o === 'eq' && c === 'status' && v === 'scheduled'), 'only a still-scheduled claim may be released')
})
await t('queued (pre-inserted, outcome unknown) or unreadable → unchanged even with the switch ON', async () => {
  for (const msgs of [[{ id: 'm1', sent_at: null }], { __error: { message: 'timeout' } }]) {
    const db = installDb(fakeDb({ comm_messages: [msgs], automation_switches: [{ mode: 'on' }] }))
    assert.equal(await orphan.resolveOrphanExecution(db, 'life_campaign_executions', 'life_campaign_enrollment', X), 'unchanged')
  }
})
await t('an advisor task is never touched', async () => {
  const db = fakeDb({})
  assert.equal(await orphan.resolveOrphanExecution(db, 't', 'e', { ...X, kind: 'advisor_outreach' }), 'unchanged')
  assert.equal(db.calls.length, 0)
})

console.log('\nAll four sweeps consult it before the backoff')
for (const [eng, table, entity] of [
  ['life-campaign', 'life_campaign_executions', 'life_campaign_enrollment'],
  ['cross-sell-life', 'xsell_life_campaign_executions', 'xsell_life_campaign_enrollment'],
  ['pipeline-winback', 'pipeline_winback_executions', 'pipeline_winback_enrollment'],
  ['district-nurture', 'district_nurture_executions', 'district_nurture_enrollment'],
]) {
  const jobs = await bundle(`src/lib/${eng}/jobs.ts`)
  await t(`${eng}: a sent orphan is reconciled, not re-queued or dead-lettered`, async () => {
    const db = installDb(fakeDb({ [table]: [[{ ...X, attempts: 4 }]], comm_messages: [[{ id: 'm1', sent_at: '2026-10-02T15:00:00Z' }]] }))
    const r = await jobs.runRetrySweep(5)
    assert.equal(r.deadLettered, 0)
    assert.equal(r.retried, 0)
    assert.match(r.note, /1 reconciled as sent/)
    const msgQ = db.calls.find((c) => c.table === 'comm_messages')
    assert.ok(msgQ.filters.some(([o, c, v]) => o === 'eq' && c === 'entity_type' && v === entity))
  })
  await t(`${eng}: switch off → the existing backoff still runs`, async () => {
    installDb(fakeDb({ [table]: [[{ ...X, attempts: 0 }]], comm_messages: [[]], automation_switches: [null] }))
    const r = await jobs.runRetrySweep(5)
    assert.equal(r.retried, 1)
  })
}
await t('migration 141 seeds the switch OFF with a rollback', () => {
  const sql = readFileSync('supabase/migrations/141_engine_retry_redispatch_switch.sql', 'utf8')
  assert.match(sql, /values \('engine_retry_redispatch', 'off',/)
  assert.match(sql, /-- ROLLBACK:\n--\s+delete from automation_switches where key = 'engine_retry_redispatch';/)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
