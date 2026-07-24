// Social Content Module — Slice 2 (Content Studio) unit gate (ADR-026).
//
// Compiles the pure Slice-2 modules (status transitions, Zod schemas) plus the
// reused compliance guardrail, and asserts: the AI draft output is Zod-validated
// and fails safe on bad output; review decisions are validated; recommendation
// language is caught (AI red-line); and the approval transition is only reachable
// from IN_REVIEW (a human gate, never a skip-from-DRAFT).

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import Module from 'node:module'

// schema.ts requires 'zod'; the compiled output lives in /tmp, so point bare-module
// resolution at the project node_modules before requiring it.
process.env.NODE_PATH = join(process.cwd(), 'node_modules')
Module.Module._initPaths()

const out = mkdtempSync(join(tmpdir(), 'fsos-social-content-'))
execSync(
  `npx tsc ` +
    `src/lib/social/status.ts ` +
    `src/lib/social/schema.ts ` +
    `src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --rootDir src`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const status = require(join(out, 'lib/social/status.js'))
const schema = require(join(out, 'lib/social/schema.js'))
const guardrail = require(join(out, 'lib/compliance/guardrail.js'))

const { canTransitionContent } = status
const { AIDraftOutputSchema, ReviewDecisionSchema, DraftRequestSchema } = schema

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

// ── AI draft output is Zod-validated and fails safe ──────────────────────────
t('a well-formed AI draft output validates', () => {
  const r = AIDraftOutputSchema.safeParse({
    variants: [{ platform: 'youtube', body: 'Educational retirement tips.', hashtags: ['#planning'] }],
    needs_review_flags: [],
    confidence: 0.8,
  })
  assert.equal(r.success, true)
})

t('AI draft output missing confidence FAILS (fail-safe, no draft created)', () => {
  const r = AIDraftOutputSchema.safeParse({
    variants: [{ platform: 'youtube', body: 'x' }],
    needs_review_flags: [],
  })
  assert.equal(r.success, false)
})

t('AI draft output with zero variants FAILS', () => {
  const r = AIDraftOutputSchema.safeParse({ variants: [], needs_review_flags: [], confidence: 0.5 })
  assert.equal(r.success, false)
})

t('AI draft output with an unknown platform FAILS', () => {
  const r = AIDraftOutputSchema.safeParse({
    variants: [{ platform: 'myspace', body: 'x' }],
    needs_review_flags: [],
    confidence: 0.5,
  })
  assert.equal(r.success, false)
})

// ── Draft request + review decision validation ───────────────────────────────
t('a draft request requires at least one platform', () => {
  assert.equal(DraftRequestSchema.safeParse({ topic: 'Retirement', platforms: [] }).success, false)
  assert.equal(DraftRequestSchema.safeParse({ topic: 'Retirement', platforms: ['youtube'] }).success, true)
})

t('review decision enum is enforced', () => {
  const good = ReviewDecisionSchema.safeParse({ version_id: '11111111-1111-1111-1111-111111111111', decision: 'approved' })
  assert.equal(good.success, true)
  const bad = ReviewDecisionSchema.safeParse({ version_id: '11111111-1111-1111-1111-111111111111', decision: 'publish' })
  assert.equal(bad.success, false)
})

// ── AI red-line: recommendation language in a draft is caught (reused) ───────
t('a draft variant with recommendation language is flagged by the reused guardrail', () => {
  assert.equal(guardrail.containsRecommendationLanguage('You should buy this whole life policy today'), true)
  assert.equal(guardrail.containsRecommendationLanguage('Learn how life insurance works in retirement'), false)
})

// ── Approval is a human gate reachable ONLY from IN_REVIEW ────────────────────
t('APPROVED is reachable only from IN_REVIEW, never a skip from DRAFT', () => {
  assert.equal(canTransitionContent('IN_REVIEW', 'APPROVED'), true)
  assert.equal(canTransitionContent('DRAFT', 'APPROVED'), false)
})

t('an approved item can be reopened to DRAFT (creates a new version on resubmit)', () => {
  assert.equal(canTransitionContent('APPROVED', 'DRAFT'), true)
})

t('a rejected item goes to ARCHIVED and cannot leave it', () => {
  assert.equal(canTransitionContent('IN_REVIEW', 'ARCHIVED'), true)
  assert.equal(canTransitionContent('ARCHIVED', 'DRAFT'), false)
})

console.log(`\nSocial Content Studio (Slice 2): ${passed} assertions passed.`)
