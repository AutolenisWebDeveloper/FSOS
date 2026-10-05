// Follow-up R12g: district nurture pauses on the agent's OWN thread, so it must resume on that
// same thread — not on "the agency has no open thread". Before: an agent paused by their own reply
// resumed at once (their thread is not agency-scoped), an unrelated client thread under the agency
// kept them paused indefinitely, and a failed count read as zero and resumed them.
// Drives the real districtNurtureTick against the stateful memdb fake; the touches read is failed
// so nothing after the resume sweep can send.
// Run: node tests/district-nurture-resume-own-thread.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const tick = await bundle('src/lib/district-nurture/tick.ts')
const AGENT_EMAIL = 'owner@agency.example'
const AGENT_PHONE = '(214) 555-0101'

function setup({ threads = [], failConversations = false } = {}) {
  const db = memDb({
    failOn: (st) =>
      (st.table === 'district_nurture_touches' && st.method === 'select') ||
      (failConversations && st.table === 'comm_conversations' && st.method === 'select'),
  })
  installDb(db)
  db.seed('district_nurture_campaigns', [{ id: 'dc1', status: 'active', version: 1, daily_enrollment_limit: 0, cooldown_days: 0 }])
  db.seed('district_nurture_enrollments', [{
    id: 'enr-1', campaign_id: 'dc1', status: 'paused_for_conversation', agency_id: 'ag1', agency_owner_id: 'ao1',
    contact_id: 'c1', email: AGENT_EMAIL, phone: AGENT_PHONE, baseline_date: '2026-09-01', current_touch_no: 1,
  }])
  db.seed('comm_conversations', threads)
  return db
}
const statusOf = (db) => db.rows('district_nurture_enrollments').find((r) => r.id === 'enr-1').status

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('District nurture resumes on the thread it paused on')

await t('the agent\'s own email thread still open → stays paused (no agency thread)', async () => {
  const db = setup({ threads: [{ id: 't1', channel: 'email', contact: AGENT_EMAIL, status: 'open', last_direction: 'inbound' }] })
  await tick.districtNurtureTick()
  assert.equal(statusOf(db), 'paused_for_conversation')
})
await t('the agent\'s own SMS thread still open → stays paused', async () => {
  const db = setup({ threads: [{ id: 't1', channel: 'sms', contact: '+12145550101', status: 'open', last_direction: 'inbound' }] })
  await tick.districtNurtureTick()
  assert.equal(statusOf(db), 'paused_for_conversation')
})
await t('an unrelated client thread under the agency does not keep the agent paused', async () => {
  const db = setup({ threads: [
    { id: 't1', channel: 'email', contact: AGENT_EMAIL, status: 'closed', last_direction: 'inbound' },
    { id: 't2', channel: 'sms', contact: '+19725550199', agency_id: 'ag1', status: 'open', last_direction: 'inbound' },
  ] })
  await tick.districtNurtureTick()
  assert.equal(statusOf(db), 'active')
})
await t('a conversation read error → stays paused (fail closed)', async () => {
  const db = setup({ failConversations: true })
  await tick.districtNurtureTick()
  assert.equal(statusOf(db), 'paused_for_conversation')
})

if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
