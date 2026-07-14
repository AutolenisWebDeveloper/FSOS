// Foundation gate — guardrail enforcement: a message that SHOULD be blocked is
// hard-blocked + escalated, never sent. Exercises the pure cores of the three
// enforcement points (comms gate, AI green/red-line validator, securities
// firewall) without a live Supabase. Run: node tests/guardrail.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-guardrail-'))
// gate.ts pulls in guardrail.ts → compliance.ts; firewall.ts is standalone. All pure.
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/compliance/firewall.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { validateAIClientMessage, containsRecommendationLanguage } = require(join(out, 'compliance/guardrail.js'))
const { findForbiddenSecuritiesFields, assertNotSecuritiesSystemOfRecord, isSecurity } = require(
  join(out, 'compliance/firewall.js'),
)

const okCtx = {
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('AI green-zone / red-line validator (guardrail 2)')

t('recommendation language is BLOCKED (the build-blocking red line)', () => {
  const r = validateAIClientMessage('Honestly, you should buy this annuity now.', {
    isSecurity: false, hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true,
  })
  assert.equal(r.allow, false)
  assert.ok(r.reasons.includes('recommendation'))
})

t('several recommendation phrasings are caught', () => {
  for (const s of [
    'I recommend the FNWL permanent policy.',
    'The best product for you is the whole life plan.',
    'You should convert to the universal life product.',
    'Replace your policy with this one.',
  ]) {
    assert.equal(containsRecommendationLanguage(s), true, s)
  }
})

t('a neutral green-zone invitation is ALLOWED', () => {
  const r = validateAIClientMessage(
    'We would love to invite you to a complimentary review of your coverage. Reply to schedule.',
    { isSecurity: false, hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true },
  )
  assert.equal(r.allow, true)
  assert.deepEqual(r.reasons, [])
})

t('securities / no-consent / out-of-hours / DNC / unapproved each block', () => {
  assert.ok(validateAIClientMessage('hello', { ...okCtx, isSecurity: true }).reasons.includes('securities'))
  assert.ok(validateAIClientMessage('hello', { ...okCtx, hasConsent: false }).reasons.includes('no_consent'))
  assert.ok(validateAIClientMessage('hello', { ...okCtx, recipientLocalHour: 22 }).reasons.includes('quiet_hours'))
  assert.ok(validateAIClientMessage('hello', { ...okCtx, onDNC: true }).reasons.includes('dnc'))
  assert.ok(
    validateAIClientMessage('hello', { ...okCtx, usesApprovedTemplateOrPolicy: false }).reasons.includes(
      'unapproved_template',
    ),
  )
})

console.log('7-step communications gate (guardrail 3)')

t('a clean, consented, in-hours message PASSES', () => {
  const r = evaluateGate({ draft: 'Reminder: your review is tomorrow at 10am.', channel: 'sms', ...okCtx })
  assert.equal(r.allowed, true)
  assert.equal(r.escalate, false)
})

t('a recommendation message is HARD-BLOCKED and ESCALATED (not sent)', () => {
  const r = evaluateGate({ draft: 'You should buy the whole life policy.', channel: 'sms', ...okCtx })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'recommendation')
  assert.equal(r.escalate, true)
})

t('a securities-flagged send is BLOCKED and ESCALATED', () => {
  const r = evaluateGate({ draft: 'Your account update.', channel: 'email', ...okCtx, isSecurity: true })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'is_security')
  assert.equal(r.escalate, true)
})

t('every block escalates; step order is consent→quiet→dnc→template→rec→security→other', () => {
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, hasConsent: false }).blockedStep, 'consent')
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 3 }).blockedStep, 'quiet_hours')
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, onDNC: true }).blockedStep, 'dnc')
  assert.equal(
    evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, usesApprovedTemplateOrPolicy: false }).blockedStep,
    'approved_template',
  )
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, otherRuleBlocked: true }).blockedStep, 'other_rule')
  // First failure in order wins: no-consent + recommendation → consent.
  const r = evaluateGate({ draft: 'you should buy this', channel: 'sms', ...okCtx, hasConsent: false })
  assert.equal(r.blockedStep, 'consent')
})

console.log('Securities firewall (guardrail 1)')

t('forbidden substantive securities fields are detected', () => {
  assert.deepEqual(findForbiddenSecuritiesFields({ account_number: '123' }), ['account_number'])
  assert.ok(findForbiddenSecuritiesFields({ nested: { order_details: 'x' } }).includes('nested.order_details'))
  assert.ok(findForbiddenSecuritiesFields({ suitability_determination: 'ok' }).length === 1)
})

t('the allowed ffs_case_ref pointer is NOT flagged', () => {
  assert.deepEqual(findForbiddenSecuritiesFields({ ffs_case_ref: 'FFS-2025-001', stage: 'application' }), [])
})

t('assertNotSecuritiesSystemOfRecord throws on substantive securities data', () => {
  assert.throws(() => assertNotSecuritiesSystemOfRecord({ brokerage_account_number: '9' }), /Securities firewall/)
  assert.doesNotThrow(() => assertNotSecuritiesSystemOfRecord({ ffs_case_ref: 'x', is_security: true }))
})

t('isSecurity reads the flag', () => {
  assert.equal(isSecurity({ is_security: true }), true)
  assert.equal(isSecurity({ is_security: false }), false)
  assert.equal(isSecurity({}), false)
})

console.log(`\nAll ${passed} assertions passed.`)
