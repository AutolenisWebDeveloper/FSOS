// The social publisher never posts through a disconnected channel (audit H-10). Disconnect sets
// status='revoked' (and cancels the channel's pending entries); the publisher used to post through
// it anyway with whatever credential remained. Drives the real publisher.ts and channels.ts
// (esbuild-bundled, fake DB); a publish attempt is detected by its append-only ledger row
// (social_publish_log), which every attempt writes.
// Run: node tests/social-revoked-channel.test.mjs
import assert from 'node:assert/strict'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

const publisher = await bundle('src/lib/social/publisher.ts')
const channels = await bundle('src/lib/social/channels.ts')

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const NOW = Date.parse('2026-10-02T12:00:00Z')
const ENTRY = { id: 'se1', version_id: 'v1', channel_id: 'ch1', scheduled_at: '2026-10-02T11:00:00Z', attempts: 0, next_attempt_at: null }
const attempts = (db) => db.calls.filter((c) => c.table === 'social_publish_log' && c.method === 'insert').length
const entryUpdates = (db) => db.calls.filter((c) => c.table === 'social_schedule_entries' && c.method === 'update').map((c) => c.payload)

console.log('The publisher refuses a revoked or missing channel')
for (const [label, ch] of [['revoked channel', { id: 'ch1', platform: 'linkedin', external_account_id: 'x', status: 'revoked', token_expires_at: null, has_credential: false }], ['missing channel', null]]) {
  await t(`${label} → entry cancelled, nothing published`, async () => {
    const db = installDb(fakeDb({ social_schedule_entries: [[ENTRY], { id: 'se1' }], social_content_versions: [{ id: 'v1', content_id: 'c1', snapshot: { body: 'x' }, status: 'APPROVED' }], social_channels: [ch] }))
    const r = await publisher.publishDueEntries(NOW)
    assert.equal(attempts(db), 0, 'a publish was attempted through a revoked channel')
    assert.equal(r.published, 0)
    assert.ok(entryUpdates(db).some((p) => p.status === 'cancelled' && p.last_error === 'channel_revoked'))
  })
}
await t('an unreadable channel releases the claim back to pending (no guess, no post)', async () => {
  const db = installDb(fakeDb({ social_schedule_entries: [[ENTRY], { id: 'se1' }], social_content_versions: [{ id: 'v1', content_id: 'c1', snapshot: { body: 'x' }, status: 'APPROVED' }], social_channels: [{ __error: { message: 'timeout' } }] }))
  await publisher.publishDueEntries(NOW)
  assert.equal(attempts(db), 0)
  assert.equal(entryUpdates(db).at(-1).status, 'pending')
})

console.log('\nDisconnecting a channel cancels its queued posts')
await t('disconnectChannel cancels the pending entries for that channel', async () => {
  const db = installDb(fakeDb({ social_channels: [{ id: 'ch1' }], social_schedule_entries: [null] }))
  const r = await channels.disconnectChannel('ch1', 'fsa:u1')
  assert.equal(r.ok, true)
  const cancel = db.calls.find((c) => c.table === 'social_schedule_entries' && c.method === 'update')
  assert.ok(cancel, 'pending entries were not cancelled')
  assert.equal(cancel.payload.status, 'cancelled')
  assert.ok(cancel.filters.some(([o, c, v]) => o === 'eq' && c === 'channel_id' && v === 'ch1'))
  assert.ok(cancel.filters.some(([o, c, v]) => o === 'eq' && c === 'status' && v === 'pending'))
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
