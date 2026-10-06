// Follow-up R12e: a broadcast's quiet-hours hold is bounded from when it became DUE — the later of its
// activation (activated_at) and its schedule (schedule_at), else the dispatch moment — never from
// created_at. A campaign drafted weeks before it was activated used to start already past its 72 h
// bound, so a quiet-hours withhold suppressed the recipient instead of holding them.
// Run: node tests/broadcast-hold-anchor.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

installDb(memDb())
const campaign = await bundle('src/lib/comms/campaign.ts')
const gate = await bundle('src/lib/comms/gate.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const NOW = '2026-10-05T03:00:00.000Z'
const iso = (h) => new Date(Date.parse(NOW) - h * 3600_000).toISOString()

console.log('The broadcast hold is bounded from when the broadcast became due')
await t('drafted 10 days ago, activated 1 hour ago → the hold still holds', async () => {
  const anchor = campaign.broadcastHoldAnchor({ created_at: iso(240), activated_at: iso(1), schedule_at: null }, NOW)
  assert.equal(anchor, iso(1))
  assert.equal(gate.quietHoursHold('quiet_hours', anchor, NOW), 'hold')
})
await t('scheduled after activation → bounded from the schedule', async () => {
  assert.equal(campaign.broadcastHoldAnchor({ created_at: iso(240), activated_at: iso(48), schedule_at: iso(2) }, NOW), iso(2))
})
await t('first dispatch during activation (activated_at not yet stamped) → bounded from now', async () => {
  assert.equal(campaign.broadcastHoldAnchor({ created_at: iso(240), activated_at: null, schedule_at: null }, NOW), NOW)
})
await t('dispatchCampaign uses it, never created_at', async () => {
  const src = readFileSync('src/lib/comms/campaign.ts', 'utf8')
  assert.match(src, /quietHoursHold\(outcome\.gate\.blockedStep, broadcastHoldAnchor\(campaign, /)
  assert.doesNotMatch(src, /campaign\.created_at as string \| null\), new Date\(\)\.toISOString\(\)\) === 'hold'/)
})
console.log(`\nAll ${passed} assertions passed.`)
