// Follow-up review of R11: an unreadable securities read holds THIS send (conversationIsSecurity →
// true) but is never written to comm_conversations.is_security. getOrCreateConversation stored it,
// and nothing ever clears that flag, so one transient error blocked every later appointment and
// service message on the thread. Only a confirmed securities household is persisted.
// Run: node tests/security-flag-not-persisted-on-error.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const convs = await bundle('src/lib/comms/conversations.ts')
let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
const seed = (failPolicies, policies = []) => {
  const db = memDb({ failOn: (q) => failPolicies && q.table === 'household_policies' })
  installDb(db)
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', email: 'pat@example.com' }])
  db.seed('households', [{ id: 'h1' }])
  db.seed('household_policies', policies)
  return db
}
console.log('A securities read error is a send-time hold, never a stored flag')

await t('new thread: a read error does not create it as securities', async () => {
  const db = seed(true)
  await convs.getOrCreateConversation('email', 'pat@example.com')
  assert.equal(db.rows('comm_conversations')[0].is_security, false)
})
await t('existing thread: a read error does not patch it to securities', async () => {
  const db = seed(true)
  db.seed('comm_conversations', [{ id: 'c1', channel: 'email', contact: 'pat@example.com', household_id: 'h1', member_id: 'm1', is_security: false, status: 'open' }])
  await convs.getOrCreateConversation('email', 'pat@example.com')
  assert.equal(db.rows('comm_conversations')[0].is_security, false)
})
await t('the send-time check still treats the read error as securities', async () => {
  seed(true)
  assert.equal(await convs.conversationIsSecurity('h1'), true)
})
await t('a confirmed securities household is still persisted', async () => {
  const db = seed(false, [{ id: 'p1', household_id: 'h1', is_security: true, deleted_at: null }])
  await convs.getOrCreateConversation('email', 'pat@example.com')
  assert.equal(db.rows('comm_conversations')[0].is_security, true)
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
