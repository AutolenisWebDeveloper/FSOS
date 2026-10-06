// Follow-up R11: every gate read that hits a database error answers RESTRICTIVELY — never "allowed".
//   • frequency caps (policy row, and the send counts) → held;
//   • purpose consent → no consent;
//   • the securities check (conversation flag, household policies) → treated as securities;
//   • the recipient location (member phone / household ZIP / contact) → no location, so the
//     all-continental window applies;
//   • the global AI kill switch / agent row → AI not approved;
//   • the member lookup → unresolved is NOT "no member": the send is withheld at consent.
// supabase-js RESOLVES { error } rather than throwing, so these are injected as returned errors.
// Run: node tests/gate-reads-fail-closed.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const policy = await bundle('src/lib/comms/dispatch-policy.ts')
const resolver = await bundle('src/lib/comms/policy-resolver.ts')
const convs = await bundle('src/lib/comms/conversations.ts')
const deps = policy.defaultPolicyDeps
const failing = (tables) => memDb({ failOn: (st) => tables.includes(st.table) && st.method === 'select' })
const seedBase = (db) => {
  db.seed('households', [{ id: 'h1', zip: '75201', referring_agency_id: null }])
  db.seed('household_members', [{ id: 'm1', household_id: 'h1', phone: '+12145550147', email: 'pat@example.com' }])
  db.seed('consents', [{ member_id: 'm1', channel: 'sms', status: 'granted' }])
  db.seed('comm_consent_purposes', [{ member_id: 'm1', channel: 'sms', purpose: 'MARKETING_SMS', status: 'granted' }])
  db.seed('comm_frequency_policy', [{ id: 'global', enabled: true, max_sms_per_day: 1, max_sms_per_7_days: 3, max_marketing_emails_per_day: 1, max_marketing_emails_per_7_days: 3, max_combined_touches_per_day: 2, min_interval_minutes: 60 }])
  db.seed('ai_policies', [{ id: 'global', gateway_enabled: false }])
  db.seed('ai_agents', [{ key: 'conversation', enabled: true }])
}

let passed = 0
const failed = []
const at = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Gate reads fail closed on a returned database error')

await at('frequency: an unreadable cap row holds the send', async () => {
  const db = failing(['comm_frequency_policy']); installDb(db); seedBase(db)
  const r = await resolver.resolveFrequency('m1', 'sms', 'MARKETING')
  assert.equal(r.allowed, false)
})
await at('frequency: an unreadable send count holds the send', async () => {
  const db = failing(['comm_messages']); installDb(db); seedBase(db)
  const r = await resolver.resolveFrequency('m1', 'sms', 'MARKETING')
  assert.equal(r.allowed, false)
})
await at('purpose consent: an unreadable channel row is not consent', async () => {
  const db = failing(['consents']); installDb(db); seedBase(db)
  assert.equal(await resolver.hasConsentForPurpose('m1', 'sms', 'MARKETING'), false)
})
await at('securities: an unreadable household-policy read counts as securities', async () => {
  const db = failing(['household_policies']); installDb(db); seedBase(db)
  assert.equal(await convs.conversationIsSecurity('h1'), true)
  assert.equal(await deps.conversationIsSecurity(null, 'h1'), true)
})
await at('securities: an unreadable conversation flag counts as securities', async () => {
  const db = failing(['comm_conversations']); installDb(db); seedBase(db)
  assert.equal(await deps.conversationIsSecurity('conv-1', null), true)
})
await at('location: an unreadable household ZIP yields no location (all-continental window)', async () => {
  const db = failing(['households']); installDb(db); seedBase(db)
  const loc = await deps.recipientLocation('m1', 'h1', '+12145550147', 'sms')
  assert.deepEqual(loc, { phone: null, zip: null })
})
await at('AI kill switch: an unreadable global policy is not approval', async () => {
  const db = failing(['ai_policies']); installDb(db); seedBase(db)
  assert.equal(await deps.aiPolicyApproved('conversation'), false)
})
await at('member lookup: an unreadable member table is unresolved, not "no member"', async () => {
  const db = failing(['household_members']); installDb(db); seedBase(db)
  const link = await convs.resolveContact('sms', '+12145550147')
  assert.equal(link.failed, true)
  const d = await policy.resolveDispatchPolicy(
    { channel: 'sms', to: '+12145550147', body: 'x', actor: 'test', templateKind: 'stored', templateId: 't1' },
    { ...deps, contactConsent: async () => true, templateApproved: async () => true, onDNC: async () => false, consentRevoked: async () => false, suppression: async () => ({ suppressed: false, resolved: true }), sendPolicy: async () => ({ consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }), smsLive: () => true, withinBusinessHours: async () => true, hoursWindow: async () => null, recipientLocation: async () => ({ phone: '+12145550147', zip: '75201' }), conversationIsSecurity: async () => false, memberConsent: async () => false },
    new Date(Date.UTC(2026, 0, 15, 18, 0)),
  )
  assert.equal(d.gate.allowed, false, 'an unresolvable member must not fall back to contact-level consent')
  assert.equal(d.gate.blockedStep, 'consent')
})
if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
