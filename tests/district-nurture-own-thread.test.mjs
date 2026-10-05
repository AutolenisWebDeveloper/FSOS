// District nurture's reply pause is keyed on the AGENT's own thread (audit B-11 / H-06 / H-07).
// It was "any open thread under the agency": the agent's own reply never paused the cadence, and
// any unrelated client thread under the agency paused it indefinitely. Now: an open thread at the
// agent's own email (exact) or phone (trailing 10 digits) whose last message came from them. A read
// error counts as in a conversation (fail closed). Drives the real data.ts loader.
// Run: node tests/district-nurture-own-thread.test.mjs
import assert from 'node:assert/strict'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

const data = await bundle('src/lib/district-nurture/data.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const SNAP = {
  agency_owner_id: 'ao1', agency_id: 'ag1', contact_id: 'c1', agency_name: 'A', owner_full_name: 'Owner',
  agency_status: 'active', owner_scope: null, email: 'Owner@Agency.example', phone: '(214) 555-0101',
  interested: false, existing_leads_user: false, is_security: false, reachable: true,
}
const campaign = { id: 'dc1', cooldown_days: 0 }
const convCalls = (db) => db.calls.filter((c) => c.table === 'comm_conversations')
const has = (call, op, col, val) => call.filters.some(([o, c, v]) => o === op && c === col && (val === undefined || v === val))

console.log('District nurture pauses on the agent\'s own reply only')
await t('never keyed on agency_id; each lookup requires an open, inbound-last thread at the agent\'s address', async () => {
  const db = installDb(fakeDb({ v_district_nurture_candidates: [SNAP], comm_conversations: [[], []] }))
  await data.loadNurtureEligibilityInput(campaign, 'ao1', 'e1')
  const calls = convCalls(db)
  assert.equal(calls.length, 2)
  for (const c of calls) {
    assert.ok(!has(c, 'eq', 'agency_id'), 'an unrelated client thread under the agency must not pause the agent')
    assert.ok(has(c, 'eq', 'status', 'open') && has(c, 'eq', 'last_direction', 'inbound'))
  }
  assert.ok(has(calls[0], 'eq', 'contact', 'owner@agency.example'))
  assert.ok(has(calls[1], 'ilike', 'contact', '%2145550101'))
})
await t('the agent\'s own reply → in a conversation', async () => {
  installDb(fakeDb({ v_district_nurture_candidates: [SNAP], comm_conversations: [[{ id: 'conv1' }]] }))
  const { input } = await data.loadNurtureEligibilityInput(campaign, 'ao1', 'e1')
  assert.equal(input.inActiveConversation, true)
})
await t('a read error → in a conversation (held)', async () => {
  installDb(fakeDb({ v_district_nurture_candidates: [SNAP], comm_conversations: [{ __error: { message: 'timeout' } }] }))
  const { input } = await data.loadNurtureEligibilityInput(campaign, 'ao1', 'e1')
  assert.equal(input.inActiveConversation, true)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
