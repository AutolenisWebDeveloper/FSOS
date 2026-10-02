// Win-Back must not pause ITSELF (audit E-06). "In an active conversation" was any OPEN thread for
// the household — including the one win-back's own first touch opened — so every enrollment paused
// after touch 1. It now means an open thread whose last message came from the CLIENT, and an
// unreadable answer counts as in a conversation (fail closed). Drives the real data.ts loader.
// Run: node tests/pipeline-winback-own-thread.test.mjs
import assert from 'node:assert/strict'
import { bundle, fakeDb, installDb } from './helpers/workshop-harness.mjs'

const data = await bundle('src/lib/pipeline-winback/data.ts')
let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
const SNAP = { opportunity_id: 'o1', household_id: 'h1', stage: 'stale', is_security: false, do_not_contact: false, has_active_advisor_opportunity: false, has_upcoming_appointment: false, stale_days: 120 }
const campaign = { id: 'c1', stale_min_days: 90 }
const convCall = (db) => db.calls.find((c) => c.table === 'comm_conversations')

console.log('Win-Back conversation pause is keyed on a CLIENT reply')
await t('the query requires an open thread whose last message is inbound', async () => {
  const db = installDb(fakeDb({ v_pipeline_winback_due: [SNAP], pipeline_winback_enrollments: [null], comm_conversations: [null] }))
  await data.loadWinbackEligibilityInput(campaign, 'o1', 'e1')
  const f = convCall(db).filters
  assert.ok(f.some(([op, c, v]) => op === 'eq' && c === 'status' && v === 'open'))
  assert.ok(f.some(([op, c, v]) => op === 'eq' && c === 'last_direction' && v === 'inbound'), 'win-back\'s own outbound thread must not count')
})
await t('a read error counts as in a conversation (the touch is held)', async () => {
  installDb(fakeDb({ v_pipeline_winback_due: [SNAP], pipeline_winback_enrollments: [null], comm_conversations: [{ __error: { message: 'timeout' } }] }))
  const { input } = await data.loadWinbackEligibilityInput(campaign, 'o1', 'e1')
  assert.equal(input.inActiveConversation, true)
})
console.log(`\nAll ${passed} assertions passed.`)
process.exit(0)
