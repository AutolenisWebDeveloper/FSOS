// Social pre-check + brand + suggestions gate (ADR-026, item 6).
//
// Compiles the PURE modules behind the "AI drafting" requirement and asserts:
//   • the securities/claims pre-check BLOCKS a draft from moving to In Review when it
//     is empty, securities-flagged, carries recommendation/claims language, embeds a
//     forbidden securities field, or overflows a selected platform's limit — and
//     PASSES clean educational content;
//   • the mandatory educational disclaimer is appended per platform (short form on X)
//     and never double-stamped, and the brand voice is available for the prompt;
//   • suggested posting windows are STATIC heuristics carrying the "not from your data"
//     label (no trend/prediction model).

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-social-precheck-'))
execSync(
  `npx tsc ` +
    `src/lib/social/precheck.ts src/lib/social/brand.ts src/lib/social/suggestions.ts ` +
    `src/lib/social/labels.ts src/lib/compliance.ts ` +
    `src/lib/compliance/firewall.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const precheck = require(join(out, 'lib/social/precheck.js'))
const brand = require(join(out, 'lib/social/brand.js'))
const suggestions = require(join(out, 'lib/social/suggestions.js'))
const { precheckContentForReview, summarizePrecheck } = precheck
const { disclaimerFor, hasDisclaimer, ensureDisclaimer, SOCIAL_BRAND_VOICE } = brand
const { suggestedPostingWindow, SUGGESTION_BASIS_LABEL, HEURISTIC_POSTING_WINDOWS } = suggestions

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

const blockCodes = (r) => r.blocks.map((b) => b.code)

// ── Pre-check gate ───────────────────────────────────────────────────────────
t('clean educational content PASSES the gate', () => {
  const r = precheckContentForReview({
    body: 'A few plain-language tips on how term life conversion works. Learn more with a quick review.',
    platforms: ['youtube', 'facebook_page'],
  })
  assert.equal(r.ok, true)
  assert.equal(r.blocks.length, 0)
})

t('empty body BLOCKS', () => {
  const r = precheckContentForReview({ body: '   ', platforms: ['youtube'] })
  assert.equal(r.ok, false)
  assert.ok(blockCodes(r).includes('empty_body'))
})

t('is_security-flagged content BLOCKS (route to human/FFS)', () => {
  const r = precheckContentForReview({ body: 'Educational post about planning.', platforms: ['youtube'], is_security: true })
  assert.equal(r.ok, false)
  assert.ok(blockCodes(r).includes('is_security'))
})

t('individualized recommendation / call-to-action language BLOCKS', () => {
  const r = precheckContentForReview({ body: 'You should buy this annuity now — it is right for you.', platforms: ['facebook_page'] })
  assert.equal(r.ok, false)
  assert.ok(blockCodes(r).includes('recommendation_language'))
})

t('a forbidden securities field in the payload BLOCKS (firewall reused)', () => {
  const r = precheckContentForReview({ body: 'Educational.', platforms: ['youtube'], media: { account_number: '123-456' } })
  assert.equal(r.ok, false)
  assert.ok(blockCodes(r).includes('securities_firewall'))
})

t('a body that overflows a selected platform limit (incl. disclaimer) BLOCKS', () => {
  const r = precheckContentForReview({ body: 'a'.repeat(275), platforms: ['x'] }) // 275 + disclaimer > 280
  assert.equal(r.ok, false)
  assert.ok(r.blocks.some((b) => b.code === 'over_platform_limit' && b.platform === 'x'))
})

t('the same body within a generous limit does NOT block', () => {
  const r = precheckContentForReview({ body: 'a'.repeat(275), platforms: ['facebook_page'] })
  assert.equal(r.ok, true)
})

t('summarizePrecheck yields a non-empty reason for a blocked draft', () => {
  const r = precheckContentForReview({ body: '', platforms: ['youtube'], is_security: true })
  assert.ok(summarizePrecheck(r).length > 0)
})

// ── Brand voice + disclaimer ─────────────────────────────────────────────────
t('brand voice principles are available for the drafter prompt', () => {
  assert.ok(Array.isArray(SOCIAL_BRAND_VOICE) && SOCIAL_BRAND_VOICE.length >= 2)
  assert.ok(SOCIAL_BRAND_VOICE.join(' ').toLowerCase().includes('educate'))
})

t('X gets a SHORT disclaimer; other platforms get the full FINRA disclaimer', () => {
  assert.ok(disclaimerFor('x').length < disclaimerFor('youtube').length)
  assert.ok(/reg bi/i.test(disclaimerFor('facebook_page')))
})

t('ensureDisclaimer appends once and is idempotent', () => {
  const once = ensureDisclaimer('Educational tips on coverage.', 'youtube')
  assert.equal(hasDisclaimer(once), true)
  const twice = ensureDisclaimer(once, 'youtube')
  assert.equal(once, twice, 'must not double-stamp the disclaimer')
})

// ── Heuristic suggestions (labeled, not a model) ─────────────────────────────
t('posting windows are static heuristics with the honesty label', () => {
  assert.match(SUGGESTION_BASIS_LABEL, /heuristic/i)
  assert.match(SUGGESTION_BASIS_LABEL, /not based on your/i)
  const w = suggestedPostingWindow('youtube')
  assert.ok(w.label && w.days && w.time)
  // every platform has a window
  for (const p of ['youtube', 'facebook_page', 'instagram', 'linkedin_company', 'x', 'tiktok']) {
    assert.ok(HEURISTIC_POSTING_WINDOWS[p], `${p} must have a heuristic window`)
  }
})

console.log(`\nSocial Pre-check: ${passed} assertions passed.`)
