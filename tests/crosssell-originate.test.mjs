// Cross-Sell opportunity origination gate — proves the PURE planner
// (lib/opportunities/crosssell.ts): a coverage gap becomes an explainable,
// deduplicated cross-sell opportunity DRAFT, an open cross-sell opportunity for the
// same household is never duplicated, an ineligible gap is skipped with a reason,
// and every draft is is_security=false (cross-sell is never a securities target).
// Compiles the pure module in isolation (no Supabase). Run: node tests/crosssell-originate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-crosssell-'))
execSync(
  `npx tsc src/lib/opportunities/crosssell.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  isEligibleGap,
  engagementForGap,
  crossSellReason,
  planCrossSellOpportunities,
  CROSS_SELL_SOURCE,
} = require(join(out, 'crosssell.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

function gap(over = {}) {
  return {
    household_id: 'hh-' + Math.random().toString(36).slice(2),
    primary_name: 'Sam Rivera',
    referring_agency_id: 'ag-1',
    next_best_line: 'life',
    gap_count: 2,
    has_life: false,
    score: 70,
    ...over,
  }
}

console.log('Eligibility (isEligibleGap)')

t('a gap with an open line and gap_count > 0 is eligible', () => {
  assert.equal(isEligibleGap(gap()), true)
})

t('no open line → not eligible', () => {
  assert.equal(isEligibleGap(gap({ next_best_line: null })), false)
  assert.equal(isEligibleGap(gap({ next_best_line: '' })), false)
})

t('gap_count 0 → not eligible', () => {
  assert.equal(isEligibleGap(gap({ gap_count: 0 })), false)
})

t('missing household_id → not eligible', () => {
  assert.equal(isEligibleGap(gap({ household_id: '' })), false)
})

console.log('Engagement + reason')

t('an agency-referred gap is co_sell; an unattributed one is direct', () => {
  assert.equal(engagementForGap(gap({ referring_agency_id: 'ag-1' })), 'co_sell')
  assert.equal(engagementForGap(gap({ referring_agency_id: null })), 'direct')
})

t('the reason is explainable and mentions the line and the no-life signal', () => {
  const r = crossSellReason(gap({ next_best_line: 'life', has_life: false, gap_count: 2 }))
  assert.match(r, /life/i)
  assert.match(r, /no life on file/i)
  assert.match(r, /2/)
})

console.log('Planning (planCrossSellOpportunities) — dedup + firewall')

t('an eligible gap with no existing opp produces one prospect draft', () => {
  const g = gap()
  const { drafts, skipped } = planCrossSellOpportunities([g], [])
  assert.equal(drafts.length, 1)
  assert.equal(skipped.length, 0)
  assert.equal(drafts[0].household_id, g.household_id)
  assert.equal(drafts[0].stage, 'prospect')
  assert.equal(drafts[0].source, CROSS_SELL_SOURCE)
  assert.equal(drafts[0].product_id, null)
  assert.equal(drafts[0].line, 'life')
  assert.equal(drafts[0].referring_agency_id, 'ag-1')
})

t('every draft is is_security=false — cross-sell is never a securities target (firewall)', () => {
  const { drafts } = planCrossSellOpportunities([gap(), gap(), gap()], [])
  assert.ok(drafts.length > 0)
  assert.ok(drafts.every((d) => d.is_security === false))
})

t('a household with an OPEN cross-sell opp is not duplicated (dedup across the household)', () => {
  const g = gap({ household_id: 'hh-dup' })
  const existing = [{ household_id: 'hh-dup', source: 'cross_sell', stage: 'fact_find' }]
  const { drafts, skipped } = planCrossSellOpportunities([g], existing)
  assert.equal(drafts.length, 0)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].reason, 'duplicate_open')
})

t('a household whose only cross-sell opp is terminal (lost/placed) CAN be re-originated', () => {
  const g = gap({ household_id: 'hh-lost' })
  const existing = [
    { household_id: 'hh-lost', source: 'cross_sell', stage: 'lost' },
    { household_id: 'hh-lost', source: 'cross_sell', stage: 'placed_issued' },
  ]
  const { drafts } = planCrossSellOpportunities([g], existing)
  assert.equal(drafts.length, 1)
})

t('an open opportunity from a DIFFERENT source does not block cross-sell origination', () => {
  const g = gap({ household_id: 'hh-ref' })
  const existing = [{ household_id: 'hh-ref', source: 'referral', stage: 'quoted_proposed' }]
  const { drafts } = planCrossSellOpportunities([g], existing)
  assert.equal(drafts.length, 1)
})

t('two gap rows for the same household in one batch only draft once', () => {
  const { drafts, skipped } = planCrossSellOpportunities(
    [gap({ household_id: 'hh-same' }), gap({ household_id: 'hh-same' })],
    [],
  )
  assert.equal(drafts.length, 1)
  assert.equal(skipped.filter((s) => s.reason === 'duplicate_open').length, 1)
})

t('an ineligible gap is skipped with a no_open_line reason', () => {
  const { drafts, skipped } = planCrossSellOpportunities([gap({ next_best_line: null })], [])
  assert.equal(drafts.length, 0)
  assert.equal(skipped[0].reason, 'no_open_line')
})

console.log(`\nAll ${passed} assertions passed.`)
