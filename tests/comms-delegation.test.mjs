// Slice 1 — Ownership resolution + delegation. Proves the two NEW pure gate steps
// and the pure delegation decision core, offline (no live Supabase), mirroring
// tests/guardrail.test.mjs.
//
//   • gate.ts gains `ownership` (0) and `delegation` (3b) steps. Both default
//     PERMISSIVE (existing callers/tests unaffected) and both HARD-BLOCK + ESCALATE
//     when explicitly failed. Ownership routes to the assignment-review queue.
//   • delegation.ts (pure) decides whether an FSA may communicate ON BEHALF OF an
//     agency owner: status ACTIVE, inside the effective/expiry window, campaign type
//     permitted, channel permitted, and the contact belongs to the delegated agency.
//
// Run: node tests/comms-delegation.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-delegation-'))
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/comms/delegation.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { evaluateDelegation } = require(join(out, 'comms/delegation.js'))

const okCtx = {
  hasConsent: true,
  recipientLocalHour: 12,
  onDNC: false,
  usesApprovedTemplateOrPolicy: true,
  isSecurity: false,
}

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Gate — ownership + delegation steps (Slice 1)')

t('BACKWARD-COMPAT: existing callers (no ownership/delegation inputs) still PASS', () => {
  const r = evaluateGate({ draft: 'Reminder: your review is tomorrow at 10am.', channel: 'sms', ...okCtx })
  assert.equal(r.allowed, true)
  assert.equal(r.escalate, false)
})

t('BACKWARD-COMPAT: existing block order preserved (consent still wins first)', () => {
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, hasConsent: false }).blockedStep, 'consent')
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, recipientLocalHour: 3 }).blockedStep, 'quiet_hours')
  assert.equal(evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, onDNC: true }).blockedStep, 'dnc')
})

t('unresolved ownership HARD-BLOCKS + ESCALATES (routes to assignment review)', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, ownershipResolved: false, ownershipConflict: 'no agency owner' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'ownership')
  assert.equal(r.escalate, true)
  assert.match(r.reason, /no agency owner/)
})

t('ownership is checked BEFORE consent (a mis-owned contact is never trusted for consent)', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, hasConsent: false, ownershipResolved: false })
  assert.equal(r.blockedStep, 'ownership')
})

t('invalid delegation HARD-BLOCKS + ESCALATES', () => {
  const r = evaluateGate({ draft: 'hi', channel: 'sms', ...okCtx, delegationValid: false, delegationReason: 'delegation EXPIRED' })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'delegation')
  assert.equal(r.escalate, true)
  assert.match(r.reason, /EXPIRED/)
})

t('delegation is checked before content approval / recommendation', () => {
  const r = evaluateGate({ draft: 'you should buy this annuity', channel: 'sms', ...okCtx, delegationValid: false })
  assert.equal(r.blockedStep, 'delegation')
})

t('a fully-resolved, delegated, consented message PASSES', () => {
  const r = evaluateGate({ draft: 'A brief review invitation.', channel: 'sms', ...okCtx, ownershipResolved: true, delegationValid: true })
  assert.equal(r.allowed, true)
})

console.log('Delegation decision core (pure)')

const NOW = '2026-07-23T15:00:00Z'
const activeDelegation = {
  status: 'ACTIVE',
  agency_id: 'agency-1',
  effective_at: '2026-01-01T00:00:00Z',
  expires_at: '2027-01-01T00:00:00Z',
  permitted_campaign_types: ['life_winback', 'birthday'],
  permitted_channels: ['sms', 'email'],
}
const check = { now: NOW, channel: 'sms', campaignType: 'life_winback', contactAgencyId: 'agency-1' }

t('an ACTIVE, in-window, in-scope delegation is VALID', () => {
  const r = evaluateDelegation(activeDelegation, check)
  assert.equal(r.valid, true)
})

t('a missing delegation is INVALID (no authority to act on behalf of)', () => {
  const r = evaluateDelegation(null, check)
  assert.equal(r.valid, false)
  assert.match(r.reason, /no active delegation/i)
})

t('non-ACTIVE status is INVALID', () => {
  for (const status of ['DRAFT', 'SUSPENDED', 'EXPIRED', 'REVOKED']) {
    const r = evaluateDelegation({ ...activeDelegation, status }, check)
    assert.equal(r.valid, false, status)
    assert.match(r.reason, new RegExp(status, 'i'))
  }
})

t('a not-yet-effective delegation is INVALID', () => {
  const r = evaluateDelegation({ ...activeDelegation, effective_at: '2026-12-01T00:00:00Z' }, check)
  assert.equal(r.valid, false)
  assert.match(r.reason, /not yet effective/i)
})

t('an expired delegation is INVALID', () => {
  const r = evaluateDelegation({ ...activeDelegation, expires_at: '2026-06-01T00:00:00Z' }, check)
  assert.equal(r.valid, false)
  assert.match(r.reason, /expired/i)
})

t('a null expiry (open-ended) is allowed while ACTIVE + effective', () => {
  const r = evaluateDelegation({ ...activeDelegation, expires_at: null }, check)
  assert.equal(r.valid, true)
})

t('a campaign type outside the permitted list is INVALID', () => {
  const r = evaluateDelegation(activeDelegation, { ...check, campaignType: 'term_conversion' })
  assert.equal(r.valid, false)
  assert.match(r.reason, /campaign type/i)
})

t('an empty/null permitted_campaign_types means ALL types permitted', () => {
  const r = evaluateDelegation({ ...activeDelegation, permitted_campaign_types: null }, { ...check, campaignType: 'anything' })
  assert.equal(r.valid, true)
})

t('a channel outside the permitted list is INVALID', () => {
  const r = evaluateDelegation({ ...activeDelegation, permitted_channels: ['email'] }, { ...check, channel: 'sms' })
  assert.equal(r.valid, false)
  assert.match(r.reason, /channel/i)
})

t('a contact who does NOT belong to the delegated agency is INVALID (no cross-agency contamination)', () => {
  const r = evaluateDelegation(activeDelegation, { ...check, contactAgencyId: 'agency-2' })
  assert.equal(r.valid, false)
  assert.match(r.reason, /agency/i)
})

t('an unknown contact agency (null) does not by itself invalidate an otherwise-valid delegation', () => {
  // The contact→agency link is validated by the ownership resolver; when the check
  // carries no contactAgencyId, delegation scope is judged on type/channel/window only.
  const r = evaluateDelegation(activeDelegation, { ...check, contactAgencyId: null })
  assert.equal(r.valid, true)
})

console.log(`\nAll ${passed} delegation/ownership assertions passed.`)
