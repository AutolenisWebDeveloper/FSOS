// Follow-up R16: zone map corrections and split area codes.
//   • 219 and ZIP3 463–464 (northwest Indiana: Gary, Hammond) are Central, not Eastern.
//   • 850 / 448 (Florida panhandle) straddle Central and Eastern (Pensacola vs Tallahassee): split
//     codes are approximate and the floor is evaluated in BOTH zones.
//   • Workshop SMS no longer hands the chokepoint a phone-only zone as the caller zone (which
//     skipped the ZIP and the both-zones rule); the chokepoint resolves it.
// Run: node tests/zone-map-splits.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

installDb(memDb())
const tz = await bundle('src/lib/comms/recipient-timezone.ts')
const policy = await bundle('src/lib/comms/dispatch-policy.ts')

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('Zone map: northwest Indiana and the Florida panhandle')
await t('area code 219 is Central', () => assert.equal(tz.timeZoneForNpa('219'), 'America/Chicago'))
await t('ZIP3 463 and 464 are Central', () => {
  assert.equal(tz.resolveRecipientTimeZone({ zip: '46320' }).timeZone, 'America/Chicago')
  assert.equal(tz.resolveRecipientTimeZone({ zip: '46402' }).timeZone, 'America/Chicago')
  assert.equal(tz.resolveRecipientTimeZone({ zip: '46204' }).timeZone, 'America/New_York', 'Indianapolis stays Eastern')
})
await t('850 and 448 are approximate and carry the other (Eastern) side', () => {
  for (const p of ['+18505551234', '+14485551234']) {
    const r = tz.resolveRecipientTimeZone({ phone: p })
    assert.equal(r.resolved, true)
    assert.equal(r.approximate, true, `${p} not marked approximate`)
    assert.ok([r.timeZone, r.secondaryTimeZone].includes('America/New_York'), `${p} never evaluated in Eastern`)
  }
})
await t('a panhandle SMS at 19:30 Central (20:30 Eastern) is held — both zones must be inside the floor', async () => {
  const deps = {
    ...policy.defaultPolicyDeps,
    resolveContactLink: async () => ({ memberId: null, householdId: null, agencyId: null }),
    memberConsent: async () => false, contactConsent: async () => true, consentRevoked: async () => false,
    onDNC: async () => false, templateApproved: async () => true, aiPolicyApproved: async () => true,
    suppression: async () => ({ suppressed: false, resolved: true }), withinBusinessHours: async () => true,
    recipientLocation: async () => ({ phone: '+18505551234', zip: null }), hoursWindow: async () => null,
    sendPolicy: async () => ({ consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }),
    smsLive: () => true, conversationIsSecurity: async () => false,
  }
  const at = new Date(Date.UTC(2026, 0, 15, 1, 30)) // Thu 19:30 CST / 20:30 EST
  const d = await policy.resolveDispatchPolicy({ channel: 'sms', to: '+18505551234', body: 'x', actor: 't', templateKind: 'stored', templateId: 't1', purpose: 'MARKETING' }, deps, at)
  assert.equal(d.gate.allowed, false)
  assert.equal(d.gate.blockedStep, 'quiet_hours')
})
await t('phone + ZIP agreeing on Central still keep 850\'s Eastern side (CodeRabbit review of R16)', () => {
  const r = tz.resolveRecipientTimeZone({ phone: '+18505551234', zip: '32401' })
  assert.equal(r.resolved, true)
  assert.ok([r.timeZone, r.secondaryTimeZone].includes('America/New_York'), JSON.stringify(r))
})
await t('three distinct zones from phone + ZIP → unplaced (every continental zone), never a dropped zone', () => {
  const r = tz.resolveRecipientTimeZone({ phone: '+18505551234', zip: '80202' })
  assert.equal(r.resolved, false)
  assert.equal(r.reason, 'conflicting_zones')
})
await t('a panhandle SMS with a Central ZIP at 19:30 Central (20:30 Eastern) is held', async () => {
  const deps = {
    ...policy.defaultPolicyDeps,
    resolveContactLink: async () => ({ memberId: null, householdId: null, agencyId: null }),
    memberConsent: async () => false, contactConsent: async () => true, consentRevoked: async () => false,
    onDNC: async () => false, templateApproved: async () => true, aiPolicyApproved: async () => true,
    suppression: async () => ({ suppressed: false, resolved: true }), withinBusinessHours: async () => true,
    recipientLocation: async () => ({ phone: '+18505551234', zip: '32401' }), hoursWindow: async () => null,
    sendPolicy: async () => ({ consentForPurpose: null, frequency: { allowed: true }, collision: { allowed: true } }),
    smsLive: () => true, conversationIsSecurity: async () => false,
  }
  const at = new Date(Date.UTC(2026, 0, 15, 1, 30))
  const d = await policy.resolveDispatchPolicy({ channel: 'sms', to: '+18505551234', body: 'x', actor: 't', templateKind: 'stored', templateId: 't1', purpose: 'MARKETING' }, deps, at)
  assert.equal(d.gate.allowed, false)
  assert.equal(d.gate.blockedStep, 'quiet_hours')
})
await t('workshop SMS does not pass a phone-only zone as the caller zone', () => {
  const src = readFileSync('src/lib/workshops/comms-engine.ts', 'utf8')
  assert.doesNotMatch(src, /timeZone: channel === 'sms' \? \(recipientZone/, 'the phone-only zone still overrides the chokepoint')
})
if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
