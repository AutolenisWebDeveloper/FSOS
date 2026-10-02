// An opt-out recorded AFTER a bare START lifted a keyword opt-out must suppress again, and a STOP
// must never relabel another kind of opt-out into a START-liftable one (owner decision 4; final
// adversarial review findings 1 and 2b).
//   • Every DNC writer refreshes created_at, which re-arms a lifted row (isDncLifted: active unless
//     lifted_at > created_at). The public web opt-out used ignoreDuplicates and never touched it.
//   • No writer relabels an existing row (shared armDncEntry: insert-if-absent, then re-arm), and
//     every non-keyword opt-out records revoke evidence that keeps a later START from lifting it.
//   • A broadcast's quiet-hours hold is bounded from when it was due (decision 3; review finding 4).
// Run: node tests/comms-optout-rearm.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const optOut = await bundle('src/lib/comms/opt-out.ts')
const consent = await bundle('src/lib/comms/contact-consent.ts')
const unsub = await bundle('src/lib/comms/unsubscribe.ts')
const OPT = { contact: '+15125551234', channel: 'sms', source: 'inbound_stop', reason: 'inbound STOP (message SM1)', consentText: 'Inbound STOP keyword' }
const dncUpsert = (db) => db.calls.find((c) => c.table === 'dnc_entries' && c.method === 'upsert')
const dncUpdates = (db) => db.calls.filter((c) => c.table === 'dnc_entries' && c.method === 'update')

// The shared writer (armDncEntry) inserts only when no row exists and otherwise only re-arms
// created_at: no opt-out ever relabels another, so a STOP cannot turn an unsubscribe into a
// START-liftable row, and an unsubscribe cannot erase a STOP. Ordering is proven exhaustively by
// tests/optout-consent-property.test.mjs; this file pins the write shapes.
console.log('A STOP never relabels another kind of opt-out')
await t('the DNC write is insert-if-absent: an existing row (e.g. an unsubscribe) keeps its reason', async () => {
  const db = installDb(fakeDb({}))
  await optOut.recordChannelOptOut(OPT)
  assert.equal(dncUpsert(db).upsertOpts?.ignoreDuplicates, true, 'an existing row must never be overwritten')
  assert.equal(dncUpsert(db).payload.reason, OPT.reason, 'a NEW row records the keyword reason')
  for (const u of dncUpdates(db)) assert.deepEqual(Object.keys(u.payload), ['created_at'], 'the re-arm touches created_at only')
})
await t('the row is re-armed (created_at refreshed) whether or not it existed', async () => {
  const db = installDb(fakeDb({}))
  await optOut.recordChannelOptOut(OPT)
  const arm = dncUpdates(db)
  assert.equal(arm.length, 1)
  assert.ok(arm[0].payload.created_at)
  assert.deepEqual(arm[0].filters, [['eq', 'contact', OPT.contact], ['eq', 'channel', 'sms']])
})
await t('the enforced write never depends on reading the prior row first', async () => {
  const db = installDb(fakeDb({ dnc_entries: [{ __error: { message: 'timeout' } }, null, null] }))
  await optOut.recordChannelOptOut(OPT)
  const first = db.calls.find((c) => c.table === 'dnc_entries')
  assert.equal(first.method, 'upsert', 'the first DNC call is the enforced write, not a read')
})

console.log('\nEvery other opt-out writer re-arms and never relabels')
await t('unsubscribe / deliverability (suppressContact) go through the shared writer', async () => {
  const db = installDb(fakeDb({}))
  await unsub.suppressContact('a@example.com', 'email', {})
  assert.equal(dncUpsert(db).upsertOpts?.ignoreDuplicates, true)
  assert.ok(dncUpdates(db).some((u) => u.payload.created_at), 're-armed')
  const ev = db.calls.find((c) => c.table === 'comm_contact_consents' && c.method === 'insert')
  assert.equal(ev?.payload.action, 'revoked', 'non-keyword revoke evidence is recorded for START to see')
  assert.equal(consent.isKeywordRevokeEvidence(ev.payload), false)
})
await t('evidence is written BEFORE the re-arm (no window where START sees a re-armed row without it)', async () => {
  const db = installDb(fakeDb({}))
  await unsub.suppressContact('a@example.com', 'email', {})
  const order = db.calls.filter((c) => c.table === 'comm_contact_consents' || (c.table === 'dnc_entries' && c.method === 'update')).map((c) => c.table)
  assert.deepEqual(order, ['comm_contact_consents', 'dnc_entries'])
})
await t('the public opt-out checks its evidence insert', () => {
  assert.match(readFileSync('src/app/api/public/consent/route.ts', 'utf8'), /if \(evidenceError\) return dbErrorResponse/)
})
await t('the public and client-portal opt-outs use the shared writer — no raw DNC upsert left', () => {
  for (const f of ['src/app/api/public/consent/route.ts', 'src/app/api/client/consent/route.ts', 'src/lib/comms/unsubscribe.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /armDncEntry\(/, f)
    assert.doesNotMatch(src, /from\('dnc_entries'\)\s*\.upsert/, f)
  }
})
await t('a re-armed row is active again (created_at newer than lifted_at)', () => {
  assert.equal(consent.isDncLifted({ created_at: '2026-10-02T12:00:00Z', lifted_at: '2026-10-02T11:00:00Z' }), false)
  assert.equal(consent.isDncLifted({ created_at: '2026-10-02T10:00:00Z', lifted_at: '2026-10-02T11:00:00Z' }), true)
})

console.log('\nA broadcast quiet-hours hold is bounded')
await t('campaign.ts bounds the hold from schedule_at, else created_at — never from "now"', () => {
  const src = readFileSync('src/lib/comms/campaign.ts', 'utf8')
  assert.match(src, /quietHoursHold\(outcome\.gate\.blockedStep, \(campaign\.schedule_at as string \| null\) \?\? \(campaign\.created_at as string \| null\), /)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
