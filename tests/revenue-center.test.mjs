// Revenue Center composition gate — proves the PURE view-model (lib/revenue/center.ts):
// opportunities roll up into an honest revenue summary that separates securities,
// revenue attributes by origination workflow (the source tags from slices 2-4), the
// pipeline/conversion funnels and at-risk/stalled buckets are correct, and data-quality
// + attribution warnings are surfaced (never hidden). Compiles the pure module in
// isolation (no Supabase). Run: node tests/revenue-center.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-revcenter-'))
execSync(
  `npx tsc src/lib/revenue/center.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const {
  classifyOpp,
  revenueSummary,
  revenueBySource,
  pipelineByStage,
  conversionFunnel,
  revenueAtRisk,
  attributionQuality,
  dataQualityWarnings,
  WON_STAGE,
  LOST_STAGE,
} = require(join(out, 'center.js'))

let passed = 0
const t = (name, fn) => {
  fn()
  passed++
  console.log('  ✓', name)
}

function opp(over = {}) {
  return {
    id: 'o-' + Math.random().toString(36).slice(2),
    stage: 'prospect',
    is_security: false,
    source: 'cross_sell',
    premium: 1800,
    expected_commission: 900,
    actual_commission: null,
    household_id: 'hh',
    contact_id: null,
    updated_at: '2026-07-21T00:00:00Z',
    ...over,
  }
}

const NOW = new Date('2026-07-22T00:00:00Z')

console.log('Classification')

t('placed_issued is won, lost is lost, others open', () => {
  assert.equal(classifyOpp(opp({ stage: WON_STAGE })), 'won')
  assert.equal(classifyOpp(opp({ stage: LOST_STAGE })), 'lost')
  assert.equal(classifyOpp(opp({ stage: 'fact_find' })), 'open')
})

console.log('Revenue summary — securities separated (firewall), no double counting')

t('expected (open, non-security) and actual (won, non-security) are summed separately', () => {
  const s = revenueSummary([
    opp({ stage: 'quoted_proposed', expected_commission: 900 }),
    opp({ stage: 'application', expected_commission: 1100 }),
    opp({ stage: WON_STAGE, actual_commission: 2000, expected_commission: 1800 }),
    opp({ stage: LOST_STAGE, expected_commission: 500 }),
  ])
  assert.equal(s.openCount, 2)
  assert.equal(s.wonCount, 1)
  assert.equal(s.lostCount, 1)
  assert.equal(s.expectedOpen, 2000) // 900 + 1100
  assert.equal(s.actualWon, 2000)
})

t('securities opportunities are tracked separately, never in the automated expected total', () => {
  const s = revenueSummary([
    opp({ stage: 'application', expected_commission: 1000, is_security: false }),
    opp({ stage: 'application', expected_commission: 5000, is_security: true }),
  ])
  assert.equal(s.expectedOpen, 1000)
  assert.equal(s.expectedSecurities, 5000)
})

console.log('Revenue by workflow (source tags — the payoff of slices 2-4)')

t('attributes open expected + won actual by origination source', () => {
  const rows = revenueBySource([
    opp({ source: 'cross_sell', stage: 'application', expected_commission: 900 }),
    opp({ source: 'cross_sell', stage: WON_STAGE, actual_commission: 1500 }),
    opp({ source: 'win_back', stage: 'prospect', expected_commission: 400 }),
    opp({ source: 'term_conversion', stage: 'quoted_proposed', expected_commission: 700 }),
    opp({ source: null, stage: 'prospect', expected_commission: 200 }),
  ])
  const cs = rows.find((r) => r.source === 'cross_sell')
  assert.equal(cs.expected, 900)
  assert.equal(cs.actual, 1500)
  assert.ok(rows.find((r) => r.source === 'win_back'))
  assert.ok(rows.find((r) => r.source === 'term_conversion'))
  // a null source is bucketed as unattributed, never dropped
  assert.ok(rows.find((r) => r.source === 'unattributed' && r.expected === 200))
})

console.log('Pipeline + conversion funnels')

t('pipeline by stage counts open non-security opps in stage order', () => {
  const buckets = pipelineByStage([
    opp({ stage: 'prospect', expected_commission: 100 }),
    opp({ stage: 'prospect', expected_commission: 100 }),
    opp({ stage: 'application', expected_commission: 500 }),
    opp({ stage: WON_STAGE }),
    opp({ stage: 'application', is_security: true, expected_commission: 999 }),
  ])
  const prospect = buckets.find((b) => b.stage === 'prospect')
  const application = buckets.find((b) => b.stage === 'application')
  assert.equal(prospect.count, 2)
  assert.equal(application.count, 1) // the securities one is excluded
  assert.equal(application.expected, 500)
})

t('conversion funnel is monotonically non-increasing (at-or-past each stage)', () => {
  const f = conversionFunnel([
    opp({ stage: 'prospect' }),
    opp({ stage: 'application' }),
    opp({ stage: WON_STAGE }),
    opp({ stage: LOST_STAGE }),
  ])
  for (let i = 1; i < f.length; i++) assert.ok(f[i].count <= f[i - 1].count)
  // the first (prospect) stage counts every non-lost opp
  assert.equal(f[0].count, 3)
})

console.log('Revenue at risk (stalled + lost)')

t('stalled = open opps not updated within the stale window; lost value is summed', () => {
  const r = revenueAtRisk(
    [
      opp({ stage: 'application', expected_commission: 900, updated_at: '2026-05-01T00:00:00Z' }), // stalled
      opp({ stage: 'application', expected_commission: 800, updated_at: '2026-07-21T00:00:00Z' }), // fresh
      opp({ stage: LOST_STAGE, expected_commission: 500 }),
    ],
    NOW,
    30,
  )
  assert.equal(r.stalledCount, 1)
  assert.equal(r.stalledExpected, 900)
  assert.equal(r.lostCount, 1)
  assert.equal(r.lostExpected, 500)
})

console.log('Attribution quality + data-quality warnings (surfaced, never hidden)')

t('attribution quality reports source + revenue coverage', () => {
  const q = attributionQuality([
    opp({ source: 'cross_sell', expected_commission: 900 }),
    opp({ source: null, expected_commission: 0 }),
    opp({ source: 'win_back', expected_commission: null }),
    opp({ source: 'term_conversion', expected_commission: 400 }),
  ])
  assert.equal(q.total, 4)
  assert.equal(q.withSource, 3)
  assert.equal(q.withRevenue, 2) // 900 and 400 only
  assert.equal(q.sourcePct, 75)
  assert.equal(q.revenuePct, 50)
})

t('data-quality warnings surface unattributed, no-revenue, and unresolved-identity opps', () => {
  const warnings = dataQualityWarnings([
    opp({ stage: 'prospect', source: null, expected_commission: 900, household_id: 'h', contact_id: null }),
    opp({ stage: 'prospect', source: 'cross_sell', expected_commission: 0, household_id: 'h' }),
    opp({ stage: 'prospect', source: 'cross_sell', expected_commission: 100, household_id: null, contact_id: null }),
  ])
  const kinds = warnings.map((w) => w.kind)
  assert.ok(kinds.includes('unattributed'))
  assert.ok(kinds.includes('missing_revenue'))
  assert.ok(kinds.includes('unresolved_identity'))
  // counts are correct
  assert.equal(warnings.find((w) => w.kind === 'unattributed').count, 1)
  assert.equal(warnings.find((w) => w.kind === 'unresolved_identity').count, 1)
})

t('no warnings when every opportunity is clean', () => {
  const warnings = dataQualityWarnings([opp({ source: 'cross_sell', expected_commission: 900, household_id: 'h' })])
  assert.equal(warnings.length, 0)
})

console.log(`\nAll ${passed} assertions passed.`)
