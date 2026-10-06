// Follow-up R12c — the workforce outreach queue: a first touch is sent at most once.
//   c) A referral first touch whose run died after the claim (status left 'drafted') was not counted
//      as touched — only 'sent' was — so the next day's build queued and sent it again. An in-flight
//      'drafted' row now counts as touched (at most once).
// Run: node tests/workforce-first-touch-once.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const wf = await bundle('src/lib/ai/workforce.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const TODAY = new Date().toISOString().slice(0, 10)
const YESTERDAY = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)

console.log('Workforce first touch')
await t('c) a referral whose first touch was claimed but never marked sent counts as touched', async () => {
  const db = memDb(); installDb(db)
  db.seed('outreach_queue', [{ id: 'q1', queue_date: YESTERDAY, agent_key: 'referral_followup', entity_type: 'referral', entity_id: 'ref-1', status: 'drafted' }])
  assert.equal(await wf.referralAlreadyTouched('ref-1'), true)
  assert.equal(await wf.referralAlreadyTouched('ref-2'), false)
})
console.log(`\nAll ${passed} assertions passed.`)
