// A caller-asserted DURABLE consent basis (booking consent, workshop registration) must not
// override a recorded REVOKE. Owner decision 5: the most recent revoke wins until a newer,
// documented opt-in. Before: `consent = … || ctx.durableConsentGranted` was ORed in without the
// revoke check the console waiver already had, so a bulk FSA revoke with no DNC row did not stop
// workshop reminder SMS or booking email (audit G-08).
// Run: node tests/comms-durable-consent-revoke.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('durable-revoke')
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0)) // 12:00 America/Chicago — inside the floor

function deps({ revoked, consentForPurpose = null }) {
  return {
    async resolveContactLink() { return { memberId: 'mem_1', householdId: null, agencyId: null } },
    async memberConsent() { return false },
    async contactConsent() { return false },
    async consentRevoked() { return revoked },
    async onDNC() { return false },
    async templateApproved() { return true },
    async aiPolicyApproved() { return true },
    async suppression() { return { suppressed: false, resolved: true } },
    async withinBusinessHours() { return true },
    async recipientLocation() { return { phone: '+12145550147', zip: '75070' } },
    async hoursWindow() { return null },
    async sendPolicy() { return { consentForPurpose, frequency: { allowed: true }, collision: { allowed: true } } },
    smsLive() { return true },
    async conversationIsSecurity() { return false },
  }
}
const ctx = (purpose) => ({
  channel: 'sms', to: '+12145550147', body: 'Reminder: your workshop starts tomorrow at 10am.', actor: 'system:test',
  memberId: 'mem_1', templateKind: 'stored', templateId: 't1', durableConsentGranted: true, purpose,
})

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Durable consent basis vs a recorded revoke (owner decision 5)')
await t('durable basis + no revoke → consent satisfied', async () => {
  const d = await mod.policy.resolveDispatchPolicy(ctx(undefined), deps({ revoked: false }), NOON)
  assert.notEqual(d.gate.blockedStep, 'consent')
})
await t('durable basis + recorded revoke → blocked at consent', async () => {
  const d = await mod.policy.resolveDispatchPolicy(ctx(undefined), deps({ revoked: true }), NOON)
  assert.equal(d.allowed, false)
  assert.equal(d.gate.blockedStep, 'consent')
})
await t('explicit purpose: durable basis cannot re-grant a revoked purpose', async () => {
  const d = await mod.policy.resolveDispatchPolicy(ctx('TRANSACTIONAL'), deps({ revoked: true, consentForPurpose: false }), NOON)
  assert.equal(d.gate.blockedStep, 'consent')
})
await t('explicit purpose: durable basis still applies when nothing was revoked', async () => {
  const d = await mod.policy.resolveDispatchPolicy(ctx('TRANSACTIONAL'), deps({ revoked: false, consentForPurpose: false }), NOON)
  assert.notEqual(d.gate.blockedStep, 'consent')
})
console.log(`\nAll ${passed} assertions passed.`)
