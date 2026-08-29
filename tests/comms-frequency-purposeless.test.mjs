// PURPOSELESS sends are still frequency-capped (audit finding P1-B).
//
// The defect this guards: `withinFrequencyCaps` was once computed only inside
// `if (ctx.purpose)`, so a campaign that declared no purpose — and the entire legacy
// `/api/campaigns/run` drip — ran with NO min-interval, per-day or combined-touch cap.
//
// The fix moved with enforcement. The frequency decision is now taken at the DISPATCH
// CHOKEPOINT's policy resolver for EVERY send, with an absent purpose defaulting to
// MARKETING for capping purposes — the same default the stream router and the quiet-hours
// floor already apply to unclassified traffic. Purpose-scoped CONSENT and §10 collision
// stay opt-in to an EXPLICIT purpose, because a defaulted purpose must never newly replace
// the channel-wide consent read or pause on a collision the caller did not opt into.
//
// This drives the REAL resolver so the assertion is that the policy call HAPPENED with the
// right input — not that a stub returned a chosen answer.
// Run: node tests/comms-frequency-purposeless.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('freq-purposeless')

// 18:00 UTC = 12:00 America/Chicago — inside the floor, so quiet hours never masks the
// frequency verdict this file is about.
const NOON = new Date(Date.UTC(2026, 0, 15, 18, 0))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

function drive({ frequencyAllowed = true, purpose = undefined, isConversationReply = undefined } = {}) {
  let lastPolicyInput = null
  // Permissive readers for everything this file is not about; `sendPolicy` is the one under
  // observation, so it captures its input rather than being asserted on indirectly.
  const policyDeps = {
    async resolveContactLink() { return { memberId: 'mem_1', householdId: null, agencyId: null } },
    async memberConsent() { return true },
    async contactConsent() { return true },
    async consentRevoked() { return false },
    async onDNC() { return false },
    async templateApproved() { return true },
    async aiPolicyApproved() { return true },
    async suppression() { return { suppressed: false, resolved: true } },
    async withinBusinessHours() { return true },
    async recipientLocation() { return { phone: null, zip: null } },
    async hoursWindow() { return null },
    async sendPolicy(input) {
      lastPolicyInput = input
      return {
        consentForPurpose: null,
        frequency: { allowed: frequencyAllowed, reason: frequencyAllowed ? undefined : 'Max SMS/day reached (3).' },
        collision: { allowed: true },
      }
    },
    smsLive() { return true },
    async conversationIsSecurity() { return false },
  }

  const calls = { escalate: [], auditSent: [], sms: [], email: [] }
  const messagingDeps = {
    resolvePolicy: (ctx) => mod.policy.resolveDispatchPolicy(ctx, policyDeps, NOON),
    escalate: async (ctx, outcome, extra) => { calls.escalate.push({ ctx, outcome, extra }) },
    auditSent: async (ctx, result) => { calls.auditSent.push({ ctx, result }) },
    deliverEmail: async (a) => { calls.email.push(a); return { ok: true, id: 'e1' } },
    deliverSms: async (a) => { calls.sms.push(a); return { ok: true, id: 's1' } },
  }

  return mod.messaging
    .sendSms('+12145550147', 'Quick note about your coverage.', 'mid-freq', {
      policy: {
        actor: 'system:test',
        entity: { type: 'comm_campaign_enrollment', id: 'enr1' },
        memberId: 'mem_1',
        templateKind: 'stored',
        templateId: 't1',
        purpose,
        isConversationReply,
      },
    }, messagingDeps)
    .then((r) => ({ r, calls, policyInput: lastPolicyInput }))
}

console.log('Frequency caps apply to PURPOSELESS sends (P1-B)')

await t('the policy resolver IS called for a send with no purpose', async () => {
  const { policyInput } = await drive({})
  assert.ok(policyInput, 'resolveSendPolicy was never called — caps skipped')
})

await t('an unclassified send defaults to MARKETING for capping', async () => {
  const { policyInput } = await drive({})
  assert.equal(policyInput.purpose, 'MARKETING', 'unclassified traffic must not escape the caps')
})

await t('a frequency block WITHHOLDS the send', async () => {
  const { r, calls } = await drive({ frequencyAllowed: false })
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'frequency')
  assert.equal(calls.sms.length, 0, 'provider never reached')
})

await t('a frequency block is a DEFERRAL, not a compliance escalation', async () => {
  const { r, calls } = await drive({ frequencyAllowed: false })
  assert.equal(r.escalated, false, 'a rate cap is operational, not a violation')
  assert.equal(calls.escalate.length, 1, 'still audited — held, never silently dropped')
  assert.equal(calls.escalate[0].outcome.escalate, false)
})

await t('within caps → the send proceeds', async () => {
  const { r, calls } = await drive({ frequencyAllowed: true })
  assert.equal(r.ok, true)
  assert.equal(calls.sms.length, 1)
})

await t('an EXPLICIT purpose is passed through unchanged (no defaulting)', async () => {
  const { policyInput } = await drive({ purpose: 'APPOINTMENT' })
  assert.equal(policyInput.purpose, 'APPOINTMENT')
})

await t('a conversation reply selects the reply cap row, not the outreach row', async () => {
  const { policyInput } = await drive({ isConversationReply: true })
  assert.equal(policyInput.frequencyPolicyId, 'reply')
  const { policyInput: outreach } = await drive({})
  assert.equal(outreach.frequencyPolicyId, 'global')
})

console.log(`\nAll ${passed} assertions passed.`)
