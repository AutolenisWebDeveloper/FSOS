// Term Conversion opportunity origination gate — proves the PURE planner
// (lib/opportunities/termconversion.ts): a convertible term policy (v_conversions_due,
// non-securities, inside an actionable window) becomes a deadline-grounded,
// deduplicated term_conversion opportunity DRAFT; a securities-flagged policy is
// EXCLUDED (routed to FFS, never originated); a policy that already has an open
// term_conversion opportunity is never duplicated; and every draft is is_security=false.
// Compiles the pure module in isolation (no Supabase). Run: node tests/termconversion-originate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-termconv-'))
execSync(
  `npx tsc src/lib/opportunities/termconversion.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  urgencyWindow,
  isEligibleConversion,
  conversionReason,
  planTermConversionOpportunities,
  TERM_CONVERSION_SOURCE,
} = require(join(out, 'termconversion.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

function row(over = {}) {
  return {
    policy_id: 'p-' + Math.random().toString(36).slice(2),
    household_id: 'hh',
    product_id: 'prod-1',
    policy_number: 'FNWL-100',
    conversion_deadline: '2026-09-01',
    is_security: false,
    days_remaining: 45,
    urgency_tier: '90',
    ...over,
  }
}

console.log('Urgency windows (urgencyWindow)')

t('days bucket into 7/14/30/60/90/180/365 windows', () => {
  assert.equal(urgencyWindow(5), '7')
  assert.equal(urgencyWindow(7), '7')
  assert.equal(urgencyWindow(10), '14')
  assert.equal(urgencyWindow(20), '30')
  assert.equal(urgencyWindow(45), '60')
  assert.equal(urgencyWindow(80), '90')
  assert.equal(urgencyWindow(150), '180')
  assert.equal(urgencyWindow(300), '365')
})

console.log('Eligibility (isEligibleConversion)')

t('a non-securities policy in an actionable window is eligible', () => {
  assert.equal(isEligibleConversion(row()), true)
})

t('a securities-flagged policy is NOT eligible (firewall)', () => {
  assert.equal(isEligibleConversion(row({ is_security: true })), false)
})

t('a beyond-window policy is not actionable', () => {
  assert.equal(isEligibleConversion(row({ urgency_tier: 'beyond' })), false)
})

t('a policy with no id or negative/absent days is not eligible', () => {
  assert.equal(isEligibleConversion(row({ policy_id: '' })), false)
  assert.equal(isEligibleConversion(row({ days_remaining: null })), false)
  assert.equal(isEligibleConversion(row({ days_remaining: -3 })), false)
})

console.log('Reason (educational, deadline-grounded, no recommendation)')

t('the reason cites the stored deadline and is educational, never a product recommendation', () => {
  const r = conversionReason(row({ days_remaining: 45, conversion_deadline: '2026-09-01' }))
  assert.match(r, /45/)
  assert.match(r, /2026-09-01/)
  assert.match(r, /educational|review/i)
  assert.doesNotMatch(r, /recommend|you should|best option|convert now to/i)
})

console.log('Planning (planTermConversionOpportunities) — firewall + dedup')

t('an eligible policy produces one prospect draft attributed to the policy + product', () => {
  const p = row()
  const { drafts, skipped } = planTermConversionOpportunities([p], [])
  assert.equal(drafts.length, 1)
  assert.equal(skipped.length, 0)
  assert.equal(drafts[0].policy_id, p.policy_id)
  assert.equal(drafts[0].product_id, 'prod-1')
  assert.equal(drafts[0].household_id, 'hh')
  assert.equal(drafts[0].stage, 'prospect')
  assert.equal(drafts[0].source, TERM_CONVERSION_SOURCE)
})

t('a securities-flagged policy is EXCLUDED with a securities_excluded reason (never drafted)', () => {
  const { drafts, skipped } = planTermConversionOpportunities([row({ is_security: true })], [])
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'securities_excluded')
})

t('every draft is is_security=false (firewall)', () => {
  const { drafts } = planTermConversionOpportunities([row(), row(), row()], [])
  assert.ok(drafts.length > 0)
  assert.ok(drafts.every((d) => d.is_security === false))
})

t('a policy with an OPEN term_conversion opp is not duplicated', () => {
  const p = row({ policy_id: 'p-dup' })
  const existing = [{ policy_id: 'p-dup', source: 'term_conversion', stage: 'fact_find' }]
  const { drafts, skipped } = planTermConversionOpportunities([p], existing)
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'duplicate_open')
})

t('a policy whose only term_conversion opp is terminal CAN be re-originated', () => {
  const p = row({ policy_id: 'p-lost' })
  const existing = [{ policy_id: 'p-lost', source: 'term_conversion', stage: 'lost' }]
  const { drafts } = planTermConversionOpportunities([p], existing)
  assert.equal(drafts.length, 1)
})

t('an open opp from a different source does not block conversion origination', () => {
  const p = row({ policy_id: 'p-x' })
  const existing = [{ policy_id: 'p-x', source: 'cross_sell', stage: 'quoted_proposed' }]
  const { drafts } = planTermConversionOpportunities([p], existing)
  assert.equal(drafts.length, 1)
})

t('two rows for the same policy in one batch only draft once', () => {
  const { drafts, skipped } = planTermConversionOpportunities(
    [row({ policy_id: 'p-same' }), row({ policy_id: 'p-same' })],
    [],
  )
  assert.equal(drafts.length, 1)
  assert.equal(skipped.filter((s) => s.reason === 'duplicate_open').length, 1)
})

t('a beyond-window policy is skipped not_actionable', () => {
  const { drafts, skipped } = planTermConversionOpportunities([row({ urgency_tier: 'beyond' })], [])
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'not_actionable')
})

console.log(`\nAll ${passed} assertions passed.`)
