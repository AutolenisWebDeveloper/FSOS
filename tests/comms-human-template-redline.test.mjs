// B3-1 PROOF — the recommendation red-line (gate step 5) is relaxed ONLY for a supervisor-approved,
// human-authored template, and NOT for AI-generated / un-templated sends — and it NEVER relaxes the
// securities firewall (step 6).
//
// Owner decision (B3-1): a licensed human may author ordinary suggestive marketing copy ("the best
// policy for you") in a template that a supervisor approves. The accountable control is the approval
// workflow, so the send gate stops blocking such wording for an approved human template — while the
// AI conversation/outreach agent keeps the full red-line, and any securities-flagged send is still
// excluded by the firewall.
// Run: node tests/comms-human-template-redline.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.b31-out-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })
execSync(
  `npx tsc src/lib/comms/gate.ts src/lib/comms/purpose.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { evaluateGate } = require(join(out, 'comms/gate.js'))
const { containsRecommendationLanguage } = require(join(out, 'compliance/guardrail.js'))

const results = []
const t = (name, fn) => { try { fn(); results.push({ pass: true, name }); console.log('  ✓', name) } catch (e) { results.push({ pass: false, name, err: e.message }); console.log('  ✗', name, '—', e.message) } }

// A recommendation-language body that the red-line matches, and a neutral control.
const RECO = 'This is the best policy for you — let\'s get you covered.'
const NEUTRAL = 'Thanks for reaching out! Happy to help you schedule a review.'
assert.ok(containsRecommendationLanguage(RECO), 'fixture must contain recommendation language')
assert.ok(!containsRecommendationLanguage(NEUTRAL), 'neutral fixture must be clean')

const base = { channel: 'sms', hasConsent: true, recipientLocalHour: 12, onDNC: false, usesApprovedTemplateOrPolicy: true, isSecurity: false }

console.log('B3-1 — recommendation red-line scoped to non-approved-template sends\n')

// 1. Approved HUMAN template + recommendation wording → NOT blocked at recommendation (allowed).
t('approved human template with suggestive copy → allowed (red-line relaxed)', () => {
  const r = evaluateGate({ ...base, draft: RECO, approvedHumanTemplate: true })
  assert.equal(r.allowed, true, `expected allowed, got blocked at ${r.blockedStep}`)
})

// 2. Same wording, NOT an approved human template (default) → still blocked at recommendation.
t('un-flagged send with suggestive copy → still blocked at recommendation', () => {
  const r = evaluateGate({ ...base, draft: RECO })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'recommendation')
})

// 3. AI-generated content must never qualify (approvedHumanTemplate=false) → still blocked.
t('AI-generated send with suggestive copy → still blocked at recommendation', () => {
  const r = evaluateGate({ ...base, draft: RECO, approvedHumanTemplate: false })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'recommendation')
})

// 4. The relaxation NEVER bypasses the securities firewall (step 6).
t('approved human template BUT securities-flagged → still blocked at is_security (firewall intact)', () => {
  const r = evaluateGate({ ...base, draft: RECO, approvedHumanTemplate: true, isSecurity: true })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'is_security')
})

// 5. Control — a neutral approved-template send is allowed (no behavior change for clean copy).
t('control — neutral approved-template send → allowed', () => {
  assert.equal(evaluateGate({ ...base, draft: NEUTRAL, approvedHumanTemplate: true }).allowed, true)
})

// 6. Control — the red-line still blocks other protected steps for an approved human template
//    (consent still required): the relaxation is scoped to step 5 only.
t('control — approved human template with NO consent → still blocked at consent (not bypassed)', () => {
  const r = evaluateGate({ ...base, draft: RECO, approvedHumanTemplate: true, hasConsent: false })
  assert.equal(r.allowed, false)
  assert.equal(r.blockedStep, 'consent')
})

const failed = results.filter((r) => !r.pass)
console.log('\n' + '─'.repeat(80))
if (failed.length) { console.error(`\n${failed.length} B3-1 assertion(s) FAILED.`); process.exit(1) }
console.log(`\nAll ${results.length} B3-1 proofs passed.`)
