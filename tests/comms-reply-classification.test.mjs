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

// ─── WHAT THE ALLOWLIST ACTUALLY BOUNDS ───────────────────────────────────────
// The safety property is TWO-PART, and the two parts bound different things. Stating it
// precisely matters, because the obvious stronger claim — "a missed risk keyword cannot
// cause an unsafe send, because the draft would also have to match one of the four shapes"
// — is FALSE as written, and these tests are what showed that. The four shapes are matched
// against the DRAFT only, so a risk topic the lists miss on the CONTACT's side still reaches
// the allowlist with a perfectly safe-looking scheduling draft.
//
//   1. CONTENT BOUND (allowlist, draft side). Whatever the topic, the AI can only auto-send
//      one of four structurally NON-SUBSTANTIVE shapes: an availability question, a
//      scheduling link, a receipt acknowledgment, or a thank-you. It cannot auto-send an
//      answer. This is the primary control and it holds regardless of the word lists.
//   2. TOPIC BOUND (risk lists, both sides). On a recognised regulated topic, even those
//      non-substantive shapes are withheld and the licensed FSA is brought in.
//
// So a keyword the lists miss degrades the outcome from "the FSA handles it" to "the AI
// replies with a scheduling invitation" — NOT to "the AI gives advice." Both halves are
// asserted below, including the residual case, so the real boundary is on the record.

// ── Part 1: the content bound. A SUBSTANTIVE draft never auto-sends, whatever it is about.
const SUBSTANTIVE_DRAFTS = [
  ['unlisted topic — viatical', 'Can we talk about a viatical settlement?', 'A viatical settlement is a niche arrangement where a third party purchases the contract.'],
  ['unlisted topic — IUL crediting', 'How does the IUL crediting rate work?', 'The crediting method depends on the index selected each segment period.'],
  ['unlisted topic — MEC', 'Would that make it a MEC?', 'MEC status depends on the seven-pay test for the contract.'],
  ['unlisted topic — trust ownership', 'Should the trust own it?', 'Ownership structure changes how the proceeds are treated at death.'],
  ['confident assertion, no risk term at all', 'is that a good idea?', 'Yes, that generally works well for families in your situation.'],
  ['reassurance, no risk term at all', 'am I ok?', 'You are in a solid spot based on what you have described so far.'],
]
for (const [label, inbound, draft] of SUBSTANTIVE_DRAFTS) {
  check(`CONTENT BOUND — ${label}: a substantive draft never auto-sends`, () => {
    const r = autoSendable(inbound, draft)
    assert.equal(r.mayAutoSend, false,
      `a substantive answer auto-sent — the content bound is broken: ${r.reason}`)
  })
}
check('CONTENT BOUND — every auto-sendable class is structurally non-substantive', () => {
  // The whole safety argument rests on this set staying small and contentless.
  const AUTO = ['availability_question', 'scheduling_link', 'receipt_acknowledgment', 'approved_thank_you']
  for (const cls of AUTO) assert.equal(mayAutoSend(cls), true, `${cls} should be auto-sendable`)
  // Nothing else the classifier can emit may auto-send.
  for (const cls of ['pricing_premium', 'policy_specific_explanation', 'securities_related',
    'financial_recommendation', 'needs_analysis_conclusion', 'product_comparison',
    'replacement_discussion', 'underwriting_question', 'complaint_or_dispute',
    'sensitive_data_request', 'case_or_application_affecting', 'term_conversion_interpretation']) {
    assert.equal(mayAutoSend(cls), false, `${cls} must never auto-send`)
  }
})

// ── Part 2: the topic bound, tested on PARAPHRASES that dodge the obvious keywords.
// Each pairs the paraphrase with a SUBSTANTIVE draft — the case that actually matters, and
// the one the content bound must catch even when the topic bound misses.
const PARAPHRASES = [
  ['cost, no price/premium/cost word', 'how much would it run me a month?', 'For someone your age it usually lands in the thirty to fifty a month range.'],
  ['cost, colloquial', 'whats the damage gonna be each month', 'Typically somewhere around forty dollars monthly.'],
  ['own coverage, no policy word', 'is the thing I signed up for in 2015 still active?', 'Yes, that one is still in force and paid up through this year.'],
  ['coverage need, no "how much coverage"', 'do I have enough to cover the kids if something happened', 'You would want roughly ten times your income to be comfortable.'],
  ['advice, no should/recommend', 'if you were me what would make sense here', 'Converting now would put you in a stronger position long term.'],
  ['replacement, no replace/surrender', 'thinking about moving to a different carrier', 'Moving carriers now would likely save you money.'],
  ['underwriting, no medical/exam word', 'will my blood pressure be a problem', 'That usually will not affect approval at your age.'],
  ['comparison, no vs/compare', 'which of those two would work out better', 'The permanent one works out better over twenty years.'],
  ['securities, no listed instrument', 'can you look at where my retirement savings are parked', 'Your retirement savings are allocated fairly aggressively right now.'],
]
for (const [label, inbound, substantiveDraft] of PARAPHRASES) {
  check(`PARAPHRASE — "${label}" with a substantive draft is held`, () => {
    const r = autoSendable(inbound, substantiveDraft)
    assert.equal(r.mayAutoSend, false,
      `a substantive answer to a paraphrased risk question auto-sent: ${r.reason}`)
  })
}

// ── The residual, pinned honestly. This is the accepted boundary, not an oversight: a
// paraphrase the topic lists miss, answered with a scheduling invitation, DOES auto-send.
// The message that goes out contains no advice — it is a hand-off to the licensed FSA —
// which is why this is acceptable rather than a defect. Pinned so that if the behaviour
// ever changes (in either direction) it is a deliberate decision, not a silent drift.
// "how much would…" IS matched by the pricing list; this colloquial form is not, which is
// exactly why it is the right specimen for the residual.
const MISSED_PARAPHRASE = 'whats the damage gonna be each month'
check('RESIDUAL — a missed paraphrase + a scheduling-only draft DOES auto-send', () => {
  const r = autoSendable(MISSED_PARAPHRASE, SAFE_DRAFT)
  assert.equal(r.mayAutoSend, true,
    'the residual closed — the topic lists now catch this paraphrase; update this pinned check')
  assert.equal(r.messageClass, 'availability_question')
  // What actually reaches the contact carries no figure, no product, no advice.
  assert.equal(/\b(recommend|should|cost|premium|price|\$|per month)\b/i.test(SAFE_DRAFT), false,
    'the residual is only acceptable while the auto-sent shapes stay contentless')
})
check('RESIDUAL — the SAME paraphrase with a substantive draft is still held (the bound)', () => {
  assert.equal(autoSendable(MISSED_PARAPHRASE, 'About forty dollars a month for someone your age.').mayAutoSend, false)
})
check('RESIDUAL — the topic lists DO catch the non-colloquial form of the same question', () => {
  assert.equal(autoSendable('how much would it run me a month?', SAFE_DRAFT).mayAutoSend, false)
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
