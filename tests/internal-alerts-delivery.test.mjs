// Follow-up R10: the FSA lead alert and the visitor acknowledgement are not dropped outside business
// hours (Sundays included) or because a quoted question trips the recommendation check.
//   • An internal FSA alert goes to the licensed FSA, not a client: exempt from business hours and
//     from the recommendation check — ONLY when the destination is the practice's own inbox (checked
//     at the chokepoint). Every other step (DNC, securities, …) still runs.
//   • The visitor acknowledgement is exempt from business hours and no longer echoes the visitor's
//     own text, so the recommendation check has nothing of theirs to trip on.
// Run: node tests/internal-alerts-delivery.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadChokepoint, makeMessagingDeps, withProviderEnv } from './helpers/chokepoint.mjs'

withProviderEnv()
process.env.FSOS_NOTIFY_EMAIL = 'leads@fsa.example'
const mod = loadChokepoint('internal-alerts')
const QUOTED = '<p>Lead message: "My old agent said we should buy whole life — is that the best policy for you to sell me?"</p>'
const SUNDAY = new Date(Date.UTC(2026, 0, 18, 18, 0)) // a Sunday, mid-day Central
const internal = { actor: 'system:notify', purpose: 'TRANSACTIONAL', templateKind: 'system_transactional', suppressible: false, consentWaived: true, businessHoursExempt: true, internalFsaRecipient: true }

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }
console.log('Internal FSA alerts and visitor acknowledgements')
await t('an FSA alert quoting a recommendation question, on a Sunday outside business hours, is delivered', async () => {
  const { messagingDeps, calls } = makeMessagingDeps(mod, { withinBusinessHours: false }, { now: SUNDAY })
  const r = await mod.messaging.sendEmail('leads@fsa.example', 'New lead', QUOTED, 'text', { policy: internal }, messagingDeps)
  assert.equal(r.ok, true, `blocked at ${r.blockedStep}: ${r.reason}`)
  assert.equal(calls.email.length, 1)
})
await t('the internal-recipient relaxation never applies to any other address', async () => {
  const { messagingDeps } = makeMessagingDeps(mod, { withinBusinessHours: true }, { now: SUNDAY })
  const r = await mod.messaging.sendEmail('client@example.com', 'New lead', QUOTED, 'text', { policy: internal }, messagingDeps)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'recommendation')
})
await t('DNC still blocks an internal alert', async () => {
  const { messagingDeps } = makeMessagingDeps(mod, { onDNC: true }, { now: SUNDAY })
  const r = await mod.messaging.sendEmail('leads@fsa.example', 'New lead', QUOTED, 'text', { policy: internal }, messagingDeps)
  assert.equal(r.ok, false)
  assert.equal(r.blockedStep, 'dnc')
})
await t('notifyFsa declares the internal recipient and the business-hours exemption; the visitor ack the exemption only', () => {
  const src = readFileSync('src/lib/notifications/transactional.ts', 'utf8')
  const fsa = src.slice(src.indexOf('export async function notifyFsa'), src.indexOf('export async function sendVisitorAck'))
  assert.match(fsa, /internalFsaAlert: true/)
  const ack = src.slice(src.indexOf('export async function sendVisitorAck'))
  assert.match(ack, /businessHoursExempt: true/)
  assert.doesNotMatch(ack.slice(0, ack.indexOf('return logOutcome')), /internalFsaAlert/)
})
await t('the contact-form acknowledgement no longer echoes the visitor\'s own text', () => {
  const src = readFileSync('src/app/api/public/contact/route.ts', 'utf8')
  const ack = src.slice(src.indexOf('sendVisitorAck({'), src.indexOf('notifyFsa({', src.indexOf('sendVisitorAck({')))
  assert.doesNotMatch(ack, /v\.data\.message/, 'the ack still echoes the message')
  assert.doesNotMatch(ack, /v\.data\.interest/, 'the ack still echoes the free-text interest')
})
console.log(`\nAll ${passed} assertions passed.`)
