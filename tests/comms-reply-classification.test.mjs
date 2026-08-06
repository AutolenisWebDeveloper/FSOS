// tests/comms-reply-classification.test.mjs
// Reply classification (§11 authority class + §9 purpose) — PURE proofs, no DB.
//
// The property that matters is FAIL-CLOSED: an auto-send class comes back only for a
// narrowly recognised green-zone shape whose exchange touches no regulated topic. Everything
// else must resolve to draft_only or blocked through evaluateAiAuthority(). These tests run
// the classifier and the authority matrix TOGETHER, so they assert the real end state
// ("may this auto-send?") rather than the intermediate label.
//
// Run: node tests/comms-reply-classification.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.reply-cls-'))
process.on('exit', () => { try { rmSync(out, { recursive: true, force: true }) } catch { /* best-effort */ } })

execSync(
  `npx tsc src/lib/comms/reply-classification.ts src/lib/comms/ai-authority.ts src/lib/comms/evaluations.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
// evaluations.ts imports ../compliance/guardrail, so tsc roots the emit at src/lib.
const { classifyReply } = require(join(out, 'comms/reply-classification.js'))
const { evaluateAiAuthority, mayAutoSend } = require(join(out, 'comms/ai-authority.js'))
const { evaluateOutboundMessage } = require(join(out, 'comms/evaluations.js'))

const results = []
function check(name, fn) {
  try { fn(); results.push({ name, pass: true }) }
  catch (e) { results.push({ name, pass: false, err: e.message }) }
}

/** Classify, then ask the authority matrix whether that class may auto-send. */
function autoSendable(inboundBody, draft, opts = {}) {
  const c = classifyReply({ inboundBody, draft, ...opts })
  return { ...c, mayAutoSend: mayAutoSend(c.messageClass ?? undefined) }
}

const SAFE_DRAFT = 'Happy to help! Would you like me to set up a time for Markist to walk you through your options?'

// ─── the purpose is fixed, and it is the one that cannot pause itself ───────────
check('purpose is always SERVICING (rank 1 — the §10 collision rule can never pause a reply)', () => {
  for (const [inb, d] of [
    ['What is term life insurance?', SAFE_DRAFT],
    ['what would my premium be?', 'Let me check on that for you.'],
    ['tell me about my 401k', 'Sure.'],
  ]) {
    assert.equal(classifyReply({ inboundBody: inb, draft: d }).purpose, 'SERVICING')
  }
})

// ─── the green-zone shapes that MAY auto-send ──────────────────────────────────
check('a scheduling/availability reply to a category question may auto-send', () => {
  const r = autoSendable('What is term life insurance?', SAFE_DRAFT)
  assert.equal(r.messageClass, 'availability_question', r.reason)
  assert.equal(r.mayAutoSend, true)
})
check('an availability question and a booking link are both recognised', () => {
  assert.equal(autoSendable('sure', 'What day works for you this week?').messageClass, 'availability_question')
  assert.equal(autoSendable('ok', 'Grab a slot here: https://markistfsa.com/book/review').messageClass, 'scheduling_link')
})
check('a plain acknowledgment or thank-you may auto-send', () => {
  assert.equal(autoSendable('here is the doc', 'Got it — passing this along to Markist.').mayAutoSend, true)
  assert.equal(autoSendable('sounds good', 'Thanks so much! Talk soon.').mayAutoSend, true)
})

// ─── every regulated topic holds, from EITHER side of the exchange ──────────────
const RISK_CASES = [
  ['securities — 401k', 'can you look at my 401k?', SAFE_DRAFT, 'securities_related'],
  ['securities — annuity', 'what about annuities?', SAFE_DRAFT, 'securities_related'],
  ['securities — in the DRAFT, not the inbound', 'sounds good', 'We could look at your portfolio. What day works?', 'securities_related'],
  ['pricing', 'how much would that cost?', SAFE_DRAFT, 'pricing_premium'],
  ['pricing — premium word', 'what is my premium?', SAFE_DRAFT, 'pricing_premium'],
  ['own policy', 'can you check my policy?', SAFE_DRAFT, 'policy_specific_explanation'],
  ['own policy — death benefit', 'what is the death benefit?', SAFE_DRAFT, 'policy_specific_explanation'],
  ['term conversion', 'when does my conversion window close?', SAFE_DRAFT, 'term_conversion_interpretation'],
  ['replacement', 'should I surrender it?', SAFE_DRAFT, 'replacement_discussion'],
  ['underwriting', 'do I need a medical exam?', SAFE_DRAFT, 'underwriting_question'],
  ['needs analysis', 'how much coverage do I need?', SAFE_DRAFT, 'needs_analysis_conclusion'],
  ['product comparison', 'is whole life or term better for me?', SAFE_DRAFT, 'product_comparison'],
  ['complaint', 'I want to file a complaint', SAFE_DRAFT, 'complaint_or_dispute'],
  ['sensitive data', 'here is my SSN 000-00-0000', SAFE_DRAFT, 'sensitive_data_request'],
  ['open application', 'what is the status of my application?', SAFE_DRAFT, 'case_or_application_affecting'],
  ['advice request', 'what do you recommend?', SAFE_DRAFT, 'financial_recommendation'],
]
for (const [label, inbound, draft, expected] of RISK_CASES) {
  check(`HOLD — ${label}`, () => {
    const r = autoSendable(inbound, draft)
    assert.equal(r.messageClass, expected, `classified ${r.messageClass}: ${r.reason}`)
    assert.equal(r.mayAutoSend, false, `${expected} must never auto-send`)
  })
}

check('securities is BLOCKED, not merely draft-only (firewall §4.1)', () => {
  const r = classifyReply({ inboundBody: 'about my IRA rollover', draft: SAFE_DRAFT })
  assert.equal(evaluateAiAuthority(r.messageClass).authority, 'blocked')
})

// ─── the fail-closed fallbacks ─────────────────────────────────────────────────
check('an unrecognised reply shape is unclassified → draft_only (never auto-send)', () => {
  const r = autoSendable('hello', 'Interesting — there are a few ways people think about that.')
  assert.equal(r.messageClass, null, `expected null, got ${r.messageClass}`)
  assert.equal(evaluateAiAuthority(undefined).authority, 'draft_only')
  assert.equal(r.mayAutoSend, false)
})
check('a responder hand-off is unclassified even though its text looks harmless', () => {
  const r = autoSendable('hi', 'Thanks for reaching out! Markist will follow up with you personally.', { modelHandedOff: true })
  assert.equal(r.messageClass, null)
  assert.equal(r.mayAutoSend, false)
  assert.match(r.reason, /hand-off/)
})
check('a long draft never auto-sends, even when it matches a safe shape', () => {
  const long = 'What day works for you? '.repeat(30)
  assert.ok(long.length > 480)
  const r = autoSendable('sure', long)
  assert.equal(r.messageClass, null)
  assert.match(r.reason, /characters/)
})
check('empty / garbage input fails closed rather than throwing', () => {
  for (const [i, d] of [['', ''], ['???', '...'], ['\n\n', '   ']]) {
    const r = autoSendable(i, d)
    assert.equal(r.mayAutoSend, false)
    assert.equal(r.purpose, 'SERVICING')
  }
})

// ─── risk detection wins over the safe shape, whatever the order ────────────────
check('a risk topic beats a safe shape in the same draft', () => {
  const r = autoSendable('ok', 'Your premium question is a good one — what day works to go over it?')
  assert.equal(r.messageClass, 'pricing_premium')
  assert.equal(r.mayAutoSend, false)
})

// ─── general category education stays green-zone (no over-blocking) ─────────────
check('product-CATEGORY education is NOT treated as policy-specific', () => {
  // "term life" as a category is explicitly green-zone; only conversion mechanics are held.
  const r = autoSendable('what is term life insurance?', 'Term life covers a set period. Want to find a time to talk it through?')
  assert.equal(r.mayAutoSend, true, `over-blocked: ${r.reason}`)
})

// ─── the full §12 evaluation, end to end ───────────────────────────────────────
check('a classified green-zone reply passes evaluateOutboundMessage with a purpose set', () => {
  const c = classifyReply({ inboundBody: 'What is term life insurance?', draft: SAFE_DRAFT })
  const e = evaluateOutboundMessage({
    draft: SAFE_DRAFT,
    messageClass: c.messageClass,
    purposeClassified: !!c.purpose,
    ownershipResolved: true,
    identityDisclosureSatisfied: true,
    consentCompatible: true,
    templateApproved: true,
  })
  assert.deepEqual(e.failures, [], `failures: ${e.failures.join(',')}`)
  assert.equal(e.mayAutoSend, true)
})
check('the SAME reply with no purpose still fails — the purpose half is load-bearing', () => {
  const e = evaluateOutboundMessage({
    draft: SAFE_DRAFT,
    messageClass: 'availability_question',
    purposeClassified: false,
    ownershipResolved: true,
    identityDisclosureSatisfied: true,
    consentCompatible: true,
    templateApproved: true,
  })
  assert.ok(e.failures.includes('missing_purpose_classification'))
  assert.equal(e.mayAutoSend, false)
})

const failed = results.filter((r) => !r.pass)
for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${r.pass ? '' : `: ${r.err}`}`)
if (failed.length) {
  console.error(`\n✗ ${failed.length}/${results.length} reply-classification assertions FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${results.length} reply-classification assertions passed.`)
