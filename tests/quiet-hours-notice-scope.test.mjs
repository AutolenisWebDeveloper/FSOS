// Follow-up R3 (owner decision 2): every automated campaign SMS is under the 09:00–20:00 floor and
// the Sunday marketing hold, WHATEVER purpose it is tagged with. A notice purpose (TRANSACTIONAL,
// APPOINTMENT, APPLICATION_STATUS, DOCUMENT_REQUEST) exempts an SMS only when the caller declares a
// single-recipient notice triggered by the person's own action (recipientTriggeredNotice) — and never
// for a send carrying a campaign key (broadcast, sequence, drip or engine).
// Run: node tests/quiet-hours-notice-scope.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

installDb(memDb())
const policy = await bundle('src/lib/comms/dispatch-policy.ts')
const PHONE = '+12145550147' // Dallas, Central
const deps = {
  ...policy.defaultPolicyDeps,
  resolveContactLink: async () => ({ memberId: null, householdId: null, agencyId: null }),
  memberConsent: async () => false,
  contactConsent: async () => true,
  consentRevoked: async () => false,
  onDNC: async () => false,
  templateApproved: async () => true,
  aiPolicyApproved: async () => true,
  suppression: async () => ({ suppressed: false, resolved: true }),
  withinBusinessHours: async () => true,
  recipientLocation: async () => ({ phone: PHONE, zip: '75201' }),
  hoursWindow: async () => null,
  sendPolicy: async () => ({ consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }),
  smsLive: () => true,
  conversationIsSecurity: async () => false,
}
const NIGHT = new Date(Date.UTC(2026, 0, 15, 5, 0)) // Wed 23:00 Central
const SUNDAY_MORNING = new Date(Date.UTC(2026, 0, 18, 16, 0)) // Sun 10:00 Central
const gate = async (extra, now = NIGHT) =>
  (await policy.resolveDispatchPolicy({ channel: 'sms', to: PHONE, body: 'x', actor: 'test', templateKind: 'stored', templateId: 't1', ...extra }, deps, now)).gate

let passed = 0
const at = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('A notice purpose no longer exempts bulk SMS from the floor')
for (const purpose of ['TRANSACTIONAL', 'APPOINTMENT', 'APPLICATION_STATUS', 'DOCUMENT_REQUEST']) {
  await at(`${purpose}: an SMS at 23:00 without the person-triggered declaration is held`, async () => {
    const g = await gate({ purpose })
    assert.equal(g.allowed, false)
    assert.equal(g.blockedStep, 'quiet_hours')
  })
  await at(`${purpose}: a campaign-keyed send is held even when it declares person-triggered`, async () => {
    const g = await gate({ purpose, recipientTriggeredNotice: true, campaignKey: 'camp-1' })
    assert.equal(g.allowed, false)
    assert.equal(g.blockedStep, 'quiet_hours')
  })
}
await at('a person-triggered single-recipient notice still goes at 23:00 (booking confirmation)', async () => {
  assert.equal((await gate({ purpose: 'APPOINTMENT', recipientTriggeredNotice: true })).allowed, true)
})
await at('the Sunday-morning hold applies to a notice-tagged SMS without the declaration', async () => {
  const g = await gate({ purpose: 'TRANSACTIONAL' }, SUNDAY_MORNING)
  assert.equal(g.allowed, false)
})
console.log(`\nAll ${passed} assertions passed.`)
