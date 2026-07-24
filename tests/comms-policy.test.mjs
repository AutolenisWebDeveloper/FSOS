// Slice 3 — Policy-engine extensions (§9/§10). Proves the PURE cores offline
// (purpose classification, frequency caps, priority collision) + the two new gate
// steps, mirroring tests/guardrail.test.mjs. Run: node tests/comms-policy.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-policy-'))
execSync(
  `npx tsc src/lib/comms/purpose.ts src/lib/comms/frequency.ts src/lib/comms/gate.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { purposeToConsentPurpose, isMarketingPurpose, purposePriority, yieldsTo, MESSAGE_PURPOSES } = require(join(out, 'comms/purpose.js'))
const { evaluateFrequency, evaluateCollision } = require(join(out, 'comms/frequency.js'))
const { evaluateGate } = require(join(out, 'comms/gate.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Purpose classification (§9)')

t('all 10 message purposes map to a consent purpose for both channels', () => {
  assert.equal(MESSAGE_PURPOSES.length, 10)
  for (const p of MESSAGE_PURPOSES) {
    for (const ch of ['sms', 'email']) {
      const cp = purposeToConsentPurpose(p, ch)
      assert.ok(typeof cp === 'string' && cp.length > 0, `${p}/${ch}`)
    }
  }
})

t('marketing + workshop are marketing purposes; servicing/transactional/birthday are not', () => {
  assert.equal(isMarketingPurpose('MARKETING'), true)
  assert.equal(isMarketingPurpose('WORKSHOP'), true)
  assert.equal(isMarketingPurpose('TRANSACTIONAL'), false)
  assert.equal(isMarketingPurpose('SERVICING'), false)
  assert.equal(isMarketingPurpose('BIRTHDAY'), false)
})

t('birthday/relationship require the birthday-communication consent (NOT implicit from a relationship)', () => {
  assert.equal(purposeToConsentPurpose('BIRTHDAY', 'sms'), 'BIRTHDAY_COMMUNICATIONS')
  assert.equal(purposeToConsentPurpose('RELATIONSHIP', 'email'), 'BIRTHDAY_COMMUNICATIONS')
})

t('marketing maps to channel marketing consent; workshop to workshop consent; appointment to reminders', () => {
  assert.equal(purposeToConsentPurpose('MARKETING', 'sms'), 'MARKETING_SMS')
  assert.equal(purposeToConsentPurpose('MARKETING', 'email'), 'MARKETING_EMAIL')
  assert.equal(purposeToConsentPurpose('WORKSHOP', 'email'), 'WORKSHOP_COMMUNICATIONS')
  assert.equal(purposeToConsentPurpose('APPOINTMENT', 'sms'), 'APPOINTMENT_REMINDERS')
  assert.equal(purposeToConsentPurpose('TRANSACTIONAL', 'email'), 'TRANSACTIONAL_EMAIL')
})

t('priority order: service/deadline outrank appointment outrank birthday outrank marketing', () => {
  assert.ok(purposePriority('SERVICING') < purposePriority('POLICY_DEADLINE') || purposePriority('SERVICING') <= purposePriority('POLICY_DEADLINE'))
  assert.ok(purposePriority('POLICY_DEADLINE') < purposePriority('APPOINTMENT'))
  assert.ok(purposePriority('APPOINTMENT') < purposePriority('BIRTHDAY'))
  assert.ok(purposePriority('BIRTHDAY') < purposePriority('MARKETING'))
  // yieldsTo: a marketing send yields to an active servicing campaign, not vice-versa.
  assert.equal(yieldsTo('MARKETING', 'SERVICING'), true)
  assert.equal(yieldsTo('SERVICING', 'MARKETING'), false)
})

console.log('Frequency caps (§9)')

const caps = {
  maxSmsPerDay: 2, maxSmsPer7Days: 5,
  maxMarketingEmailsPerDay: 1, maxMarketingEmailsPer7Days: 3,
  maxCombinedTouchesPerDay: 4, minIntervalMinutes: 30,
}
const zeroCounts = { smsToday: 0, sms7Days: 0, marketingEmailsToday: 0, marketingEmails7Days: 0, combinedTouchesToday: 0, minutesSinceLastSend: null }

t('a first send within all caps is allowed', () => {
  assert.equal(evaluateFrequency({ channel: 'sms', purpose: 'MARKETING', counts: zeroCounts, caps }).allowed, true)
})

t('min-interval blocks a too-soon send', () => {
  const r = evaluateFrequency({ channel: 'sms', purpose: 'MARKETING', counts: { ...zeroCounts, minutesSinceLastSend: 10 }, caps })
  assert.equal(r.allowed, false)
  assert.match(r.reason, /interval/i)
})

t('max SMS/day blocks; max SMS/7-days blocks', () => {
  assert.equal(evaluateFrequency({ channel: 'sms', purpose: 'SERVICING', counts: { ...zeroCounts, smsToday: 2 }, caps }).allowed, false)
  assert.equal(evaluateFrequency({ channel: 'sms', purpose: 'SERVICING', counts: { ...zeroCounts, sms7Days: 5 }, caps }).allowed, false)
})

t('marketing-email caps apply to marketing, but NOT to a transactional email', () => {
  assert.equal(evaluateFrequency({ channel: 'email', purpose: 'MARKETING', counts: { ...zeroCounts, marketingEmailsToday: 1 }, caps }).allowed, false)
  // a transactional email is not subject to the marketing-email cap
  assert.equal(evaluateFrequency({ channel: 'email', purpose: 'TRANSACTIONAL', counts: { ...zeroCounts, marketingEmailsToday: 9 }, caps }).allowed, true)
})

t('combined-touches/day cap applies to every purpose', () => {
  assert.equal(evaluateFrequency({ channel: 'email', purpose: 'SERVICING', counts: { ...zeroCounts, combinedTouchesToday: 4 }, caps }).allowed, false)
})

console.log('Priority collision (§10)')

t('an active conversation pauses promotional/relationship sends but not necessary servicing', () => {
  assert.equal(evaluateCollision({ candidatePurpose: 'MARKETING', activeConversation: true, activeCampaignPurpose: null }).allowed, false)
  assert.equal(evaluateCollision({ candidatePurpose: 'BIRTHDAY', activeConversation: true, activeCampaignPurpose: null }).allowed, false)
  assert.equal(evaluateCollision({ candidatePurpose: 'SERVICING', activeConversation: true, activeCampaignPurpose: null }).allowed, true)
  assert.equal(evaluateCollision({ candidatePurpose: 'POLICY_DEADLINE', activeConversation: true, activeCampaignPurpose: null }).allowed, true)
})

t('a lower-priority campaign yields to an active higher-priority one', () => {
  assert.equal(evaluateCollision({ candidatePurpose: 'MARKETING', activeConversation: false, activeCampaignPurpose: 'POLICY_DEADLINE' }).allowed, false)
  assert.equal(evaluateCollision({ candidatePurpose: 'POLICY_DEADLINE', activeConversation: false, activeCampaignPurpose: 'MARKETING' }).allowed, true)
})

console.log('Gate steps — frequency + collision (non-escalating deferrals)')

const okCtx = { hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }

t('BACKWARD-COMPAT: existing callers (no frequency/collision inputs) still PASS', () => {
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx }).allowed, true)
})

t('a frequency-capped send is BLOCKED but does NOT escalate (operational deferral)', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, withinFrequencyCaps: false, frequencyReason: 'Max SMS/day reached (2).' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'frequency')
  assert.equal(r.escalate, false)
  assert.match(r.reason, /Max SMS/)
})

t('a collision-paused send is BLOCKED but does NOT escalate', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, collisionPaused: true, collisionReason: 'higher-priority campaign active' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'collision')
  assert.equal(r.escalate, false)
})

t('compliance blocks still take precedence over the operational deferrals', () => {
  // no consent + frequency-capped → consent (compliance) surfaces first and escalates.
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, hasConsent: false, withinFrequencyCaps: false })
  assert.equal(r.blockedStep, 'consent')
  assert.equal(r.escalate, true)
})

t('frequency/collision are LAST — a DNC / delegation / securities failure escalates first', () => {
  // DNC + frequency-capped → DNC (escalates), not a silent frequency deferral.
  const dnc = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, onDNC: true, withinFrequencyCaps: false })
  assert.equal(dnc.blockedStep, 'dnc')
  assert.equal(dnc.escalate, true)
  // invalid delegation + collision-paused → delegation (escalates), not a silent pause.
  const del = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, delegationValid: false, collisionPaused: true })
  assert.equal(del.blockedStep, 'delegation')
  assert.equal(del.escalate, true)
  // securities + frequency-capped → is_security (firewall escalates), not a deferral.
  const sec = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, isSecurity: true, withinFrequencyCaps: false })
  assert.equal(sec.blockedStep, 'is_security')
  assert.equal(sec.escalate, true)
})

console.log(`\nAll ${passed} policy-engine assertions passed.`)
