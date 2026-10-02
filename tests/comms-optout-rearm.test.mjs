// An opt-out recorded AFTER a bare START lifted a keyword opt-out must suppress again, and a STOP
// must never relabel another kind of opt-out into a START-liftable one (owner decision 4; final
// adversarial review findings 1 and 2b).
//   • Every DNC writer refreshes created_at, which re-arms a lifted row (isDncLifted: active unless
//     lifted_at > created_at). The public web opt-out used ignoreDuplicates and never touched it.
//   • recordChannelOptOut keeps an existing non-keyword reason (unsubscribe / web / operator), so a
//     later START cannot lift it; an unreadable prior row gets a non-keyword reason (fail closed).
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

console.log('A STOP never relabels another kind of opt-out')
await t('existing unsubscribe row keeps its reason (START can never lift it)', async () => {
  const db = installDb(fakeDb({ dnc_entries: [[{ reason: 'unsubscribe' }], null] }))
  await optOut.recordChannelOptOut(OPT)
  assert.equal(dncUpsert(db).payload.reason, 'unsubscribe')
  assert.ok(dncUpsert(db).payload.created_at, 're-armed')
  assert.equal(consent.isKeywordOptOutReason(dncUpsert(db).payload.reason), false)
})
await t('an existing keyword row (or none) takes the keyword reason', async () => {
  for (const prior of [[], [{ reason: 'inbound STOP (old)' }]]) {
    const db = installDb(fakeDb({ dnc_entries: [prior, null] }))
    await optOut.recordChannelOptOut(OPT)
    assert.equal(dncUpsert(db).payload.reason, OPT.reason)
  }
})
await t('an unreadable prior row → a non-keyword reason, and the enforced write still happens', async () => {
  const db = installDb(fakeDb({ dnc_entries: [{ __error: { message: 'timeout' } }, null] }))
  await optOut.recordChannelOptOut(OPT)
  assert.ok(dncUpsert(db), 'the DNC write was skipped')
  assert.equal(consent.isKeywordOptOutReason(dncUpsert(db).payload.reason), false)
})

console.log('\nEvery other opt-out writer re-arms a lifted row')
await t('unsubscribe / deliverability (suppressContact) stamps created_at', async () => {
  const db = installDb(fakeDb({}))
  await unsub.suppressContact('a@example.com', 'email', {})
  assert.ok(dncUpsert(db).payload[0].created_at)
})
await t('the public and client-portal opt-outs stamp created_at; the public one no longer ignores duplicates', () => {
  const pub = readFileSync('src/app/api/public/consent/route.ts', 'utf8')
  assert.match(pub, /reason: 'public opt-out', created_at: new Date\(\)\.toISOString\(\)/)
  assert.doesNotMatch(pub, /ignoreDuplicates: true/)
  assert.match(readFileSync('src/app/api/client/consent/route.ts', 'utf8'), /reason: 'client opt-out', created_at: new Date\(\)\.toISOString\(\)/)
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
