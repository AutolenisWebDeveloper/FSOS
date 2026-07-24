// Slice 5 — AI authority matrix (§11) + communication evaluations (§12). Proves the pure
// cores offline, mirroring tests/guardrail.test.mjs. Run: node tests/comms-ai-authority.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-aiauth-'))
execSync(
  `npx tsc src/lib/comms/ai-authority.ts src/lib/comms/evaluations.ts ` +
    `src/lib/compliance/guardrail.ts src/lib/compliance/firewall.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateAiAuthority, mayAutoSend } = require(join(out, 'comms/ai-authority.js'))
const { evaluateOutboundMessage } = require(join(out, 'comms/evaluations.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('AI authority matrix (§11)')

t('approved low-risk classes AUTO-SEND', () => {
  for (const c of [
    'approved_first_touch', 'scheduled_campaign', 'birthday', 'appointment_confirmation',
    'appointment_reminder', 'scheduling_link', 'receipt_acknowledgment',
    'stop_help_unsubscribe_confirmation', 'availability_question', 'approved_thank_you',
  ]) {
    assert.equal(evaluateAiAuthority(c).authority, 'auto_send', c)
    assert.equal(mayAutoSend(c), true, c)
  }
})

t('advisory / policy-specific / pricing / sensitive / case-affecting classes are DRAFT-ONLY', () => {
  for (const c of [
    'policy_specific_explanation', 'term_conversion_interpretation', 'pricing_premium',
    'coverage_recommendation', 'needs_analysis_conclusion', 'product_comparison',
    'replacement_discussion', 'underwriting_question', 'complaint_or_dispute',
    'sensitive_data_request', 'financial_recommendation', 'case_or_application_affecting',
  ]) {
    assert.equal(evaluateAiAuthority(c).authority, 'draft_only', c)
    assert.equal(mayAutoSend(c), false, c)
  }
})

t('securities-related is BLOCKED (firewall)', () => {
  assert.equal(evaluateAiAuthority('securities_related').authority, 'blocked')
  assert.equal(mayAutoSend('securities_related'), false)
})

t('an UNKNOWN/unclassified class fails safe to DRAFT-ONLY (never auto-sends)', () => {
  assert.equal(evaluateAiAuthority('something_new').authority, 'draft_only')
  assert.equal(evaluateAiAuthority(null).authority, 'draft_only')
  assert.equal(mayAutoSend(undefined), false)
})

console.log('Communication evaluations (§12)')

const clean = {
  draft: 'Would you be open to a brief review? Reply to schedule.',
  messageClass: 'approved_first_touch',
  purposeClassified: true,
  ownershipResolved: true,
  identityDisclosureSatisfied: true,
  consentCompatible: true,
  templateApproved: true,
}

t('a clean, auto-send-class message PASSES and may auto-send', () => {
  const r = evaluateOutboundMessage(clean)
  assert.equal(r.pass, true)
  assert.equal(r.mayAutoSend, true)
  assert.deepEqual(r.failures, [])
})

t('a draft-only class PASSES evaluation but may NOT auto-send (held for the FSA)', () => {
  const r = evaluateOutboundMessage({ ...clean, messageClass: 'coverage_recommendation' })
  assert.equal(r.pass, true)
  assert.equal(r.authority, 'draft_only')
  assert.equal(r.mayAutoSend, false)
})

t('recommendation language FAILS (unsupported recommendation)', () => {
  const r = evaluateOutboundMessage({ ...clean, draft: 'You should buy the whole life policy now.' })
  assert.equal(r.pass, false)
  assert.ok(r.failures.includes('unsupported_recommendation'))
  assert.equal(r.mayAutoSend, false)
})

t('each missing signal produces its own failure; all are collected', () => {
  const r = evaluateOutboundMessage({
    draft: 'hello',
    messageClass: 'securities_related',
    purposeClassified: false,
    ownershipResolved: false,
    identityDisclosureSatisfied: false,
    consentCompatible: false,
    templateApproved: false,
    containsSensitiveData: true,
    statesUnverifiedFact: true,
  })
  assert.equal(r.pass, false)
  for (const f of [
    'securities_blocked', 'missing_purpose_classification', 'ownership_unresolved',
    'identity_disclosure_missing', 'consent_incompatible', 'template_or_policy_not_approved',
    'prohibited_sensitive_info', 'unverified_fact_or_date',
  ]) {
    assert.ok(r.failures.includes(f), f)
  }
})

t('a prohibited-sensitive-info flag blocks even an otherwise-clean auto-send class', () => {
  const r = evaluateOutboundMessage({ ...clean, containsSensitiveData: true })
  assert.equal(r.pass, false)
  assert.ok(r.failures.includes('prohibited_sensitive_info'))
})

console.log(`\nAll ${passed} AI-authority + evaluation assertions passed.`)
