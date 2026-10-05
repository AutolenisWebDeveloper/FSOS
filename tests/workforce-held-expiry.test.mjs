// Follow-up R12d — the workforce outreach queue: held rows are expired, never left forever.
//   d) Rows set to 'held' (a self-clearing hold) were never released or expired. Before each build,
//      held rows from earlier days are expired to 'skipped' with the hold recorded; the build then
//      re-queues the still-eligible target with a fresh row.
// Run: node tests/workforce-held-expiry.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const wf = await bundle('src/lib/ai/workforce.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const TODAY = new Date().toISOString().slice(0, 10)
const YESTERDAY = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)

console.log('Workforce held rows')
await t('d) held rows from earlier days are expired (skipped, hold recorded); today\'s are left alone', async () => {
  const db = memDb(); installDb(db)
  db.seed('outreach_queue', [
    { id: 'old', queue_date: YESTERDAY, agent_key: 'referral_followup', entity_type: 'referral', entity_id: 'r1', status: 'held', block_reason: 'frequency' },
    { id: 'new', queue_date: TODAY, agent_key: 'referral_followup', entity_type: 'referral', entity_id: 'r2', status: 'held', block_reason: 'frequency' },
  ])
  const n = await wf.expireStaleHolds(TODAY)
  assert.equal(n, 1)
  const old = db.rows('outreach_queue').find((r) => r.id === 'old')
  assert.equal(old.status, 'skipped')
  assert.match(old.block_reason, /hold expired.*frequency/)
  assert.equal(db.rows('outreach_queue').find((r) => r.id === 'new').status, 'held')
})
console.log(`\nAll ${passed} assertions passed.`)
