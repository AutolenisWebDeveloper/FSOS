// Follow-up R12h: the resume job decides conversation mode from the member's most recent thread.
// It ordered last_message_at descending, which Postgres sorts NULLS FIRST — so an empty thread (no
// message yet, last_message_at NULL) won and decided the mode: an empty closed thread resumed a
// member whose real thread was still open, and an empty open thread held a member whose real
// thread had closed. Now empty threads are skipped and NULLs never sort first.
// memdb orders NULLs the way Postgres does (largest value), so this reproduces the live ordering.
// Run: node tests/resume-member-thread-order.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const handlers = await bundle('src/jobs/handlers.ts')
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString()

function seed(threads) {
  const db = memDb(); installDb(db)
  db.seed('comm_campaign_enrollments', [{ id: 'enr-1', campaign_id: 'camp-1', member_id: 'm1', household_id: 'h1', status: 'paused_for_conversation', current_step: 1 }])
  // A recent inbound, so the quiet-window resume cannot fire; only the thread status decides.
  db.seed('comm_messages', [{ id: 'msg-1', member_id: 'm1', direction: 'inbound', created_at: HOUR_AGO }])
  db.seed('comm_conversations', threads)
  return db
}
const statusOf = (db) => db.rows('comm_campaign_enrollments').find((r) => r.id === 'enr-1').status

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Conversation mode is decided by the member\'s latest real thread, not an empty one')

await t('real thread open + empty closed thread → stays paused', async () => {
  const db = seed([
    { id: 'real', member_id: 'm1', status: 'open', last_message_at: HOUR_AGO },
    { id: 'empty', member_id: 'm1', status: 'closed', last_message_at: null },
  ])
  await handlers.resumePausedEnrollments()
  assert.equal(statusOf(db), 'paused_for_conversation')
})
await t('real thread closed + empty open thread → resumes', async () => {
  const db = seed([
    { id: 'real', member_id: 'm1', status: 'closed', last_message_at: HOUR_AGO },
    { id: 'empty', member_id: 'm1', status: 'open', last_message_at: null },
  ])
  await handlers.resumePausedEnrollments()
  assert.equal(statusOf(db), 'enrolled')
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
