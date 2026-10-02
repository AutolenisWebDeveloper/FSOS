// Quiet hours across the Sun 2026-11-01 DST change, and the Sunday-morning marketing hold
// (owner decisions 1–2, docs/ops/automation-inventory.md §10). Drives the REAL chokepoint
// (messaging.ts + dispatch-policy.ts + gate.ts) for a Dallas recipient (America/Chicago):
//   • the floor is evaluated in the recipient's local time, DST-correct on both sides of the change;
//   • marketing SMS is held until 12:00 local on Sundays (Nov 1 2026 IS a Sunday);
//   • an immediate appointment notice is not subject to either.
// Run: node tests/quiet-hours-sunday-dst.test.mjs
import assert from 'node:assert/strict'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
const mod = loadChokepoint('qh-sunday-dst')
const DALLAS = '+12145550147'
const CLEAN = 'Your annual review window is open — reply to schedule.'

function smsAt(now, purpose = 'MARKETING') {
  const { messagingDeps, calls } = makeMessagingDeps(mod, {}, { now })
  return mod.messaging
    .sendSms(DALLAS, CLEAN, 'mid-qh', {
      policy: { actor: 'agent:test', entity: { type: 'household', id: 'h1' }, purpose, templateKind: 'stored', templateId: 't1', suppressible: false },
    }, messagingDeps)
    .then((r) => ({ r, calls }))
}
const at = (iso) => new Date(iso)

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Recipient-local floor across the Nov 1 2026 DST change (America/Chicago)')
await t('Sat Oct 31 13:30Z = 08:30 CDT → held (before 09:00)', async () => {
  const { r } = await smsAt(at('2026-10-31T13:30:00Z')); assert.equal(r.blockedStep, 'quiet_hours')
})
await t('Sat Oct 31 14:30Z = 09:30 CDT → sends', async () => {
  const { r } = await smsAt(at('2026-10-31T14:30:00Z')); assert.equal(r.ok, true)
})
await t('Mon Nov 2 14:30Z = 08:30 CST (the same UTC hour that was 09:30 the week before) → held', async () => {
  const { r } = await smsAt(at('2026-11-02T14:30:00Z')); assert.equal(r.blockedStep, 'quiet_hours')
})
await t('Mon Nov 2 15:00Z = 09:00 CST → sends', async () => {
  const { r } = await smsAt(at('2026-11-02T15:00:00Z')); assert.equal(r.ok, true)
})
await t('Mon Nov 2 02:30Z = Sun 20:30 CST → held (after 20:00)', async () => {
  const { r } = await smsAt(at('2026-11-02T02:30:00Z')); assert.equal(r.blockedStep, 'quiet_hours')
})

console.log('\nSunday marketing hold until 12:00 local (owner decision 2)')
await t('Sun Nov 1 15:30Z = 09:30 CST → marketing HELD (Sunday before noon)', async () => {
  const { r, calls } = await smsAt(at('2026-11-01T15:30:00Z'))
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'quiet_hours')
  assert.match(r.reason, /Sundays/)
  assert.equal(calls.sms.length, 0)
})
await t('Sun Nov 1 18:00Z = 12:00 CST → marketing sends', async () => {
  const { r } = await smsAt(at('2026-11-01T18:00:00Z')); assert.equal(r.ok, true)
})
await t('Sun Nov 1 15:30Z: POLICY_DEADLINE (not marketing-class) is inside the floor → sends', async () => {
  const { r } = await smsAt(at('2026-11-01T15:30:00Z'), 'POLICY_DEADLINE'); assert.equal(r.ok, true)
})
await t('Sun Nov 1 15:30Z: an immediate APPOINTMENT notice is not held', async () => {
  const { r } = await smsAt(at('2026-11-01T15:30:00Z'), 'APPOINTMENT'); assert.equal(r.ok, true)
})
await t('Sat 09:30 local is not a Sunday → marketing sends', async () => {
  const { r } = await smsAt(at('2026-10-31T14:30:00Z')); assert.equal(r.ok, true)
})
console.log(`\nAll ${passed} assertions passed.`)
