// Template-library view filters (src/lib/comms/template-catalog.ts) — pure, DB-free.
// Proves the two derived axes the /app/comms/templates filter bar depends on:
//   • AI conversation starters are channel 'sms' in the DB, so they MUST be separated from
//     plain SMS by the touch kind (or the `*_ai` category fallback) — never by channel.
//   • Campaign membership comes from the ADR-033 catalog view, with the seed category map
//     as the fallback, and templates no campaign references fall to the Template Library.
// Also pins the facet-count contract (each axis counted with the OTHER filters applied) and
// that an untrusted query param can never widen the view.
// Run: node tests/comms-template-filters.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-template-catalog-'))
execSync(
  `npx tsc src/lib/comms/template-catalog.ts --outDir ${out} --module commonjs --target es2020 ` +
    `--moduleResolution node --skipLibCheck --esModuleInterop --lib es2020,dom`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const C = require(join(out, 'template-catalog.js'))

// Counts test CASES, not individual assertions — each `t(...)` below carries several.
let cases = 0
const t = (name, fn) => {
  fn()
  cases++
  console.log('  ✓', name)
}

// A miniature library mirroring the real seeds: campaign email/sms/AI assets, a workshop
// asset, and two standalone library templates.
const TEMPLATES = [
  { id: 'e1', name: 'Life Conversion — Email #1', channel: 'email', category: 'life_conversion', approval_status: 'draft', version: 1 },
  { id: 'd1', name: 'Life Conversion — SMS #1', channel: 'sms', category: 'life_conversion', approval_status: 'draft', version: 1 },
  { id: 'c1', name: 'Life Conversion — Conversation #1', channel: 'sms', category: 'life_conversion_ai', approval_status: 'draft', version: 1 },
  { id: 'x1', name: 'Cross-Sell Life — SMS #1', channel: 'sms', category: 'cross_sell_life', approval_status: 'approved', version: 2 },
  { id: 'xa1', name: 'Cross-Sell Life — AI 1', channel: 'sms', category: 'cross_sell_life_ai', approval_status: 'draft', version: 1 },
  { id: 'w1', name: 'Workshop reminder', channel: 'email', category: null, approval_status: 'approved', version: 1 },
  { id: 'l1', name: 'Ad-hoc manual — Email', channel: 'email', category: 'ad_hoc', approval_status: 'approved', version: 1 },
  { id: 'l2', name: 'Annual review invitation', channel: 'sms', category: 'policy_review', approval_status: 'approved', version: 1 },
]

// comm_sendable_assets rows with a campaign (the library rows of the view are filtered out
// by the page's `.not('campaign_key','is',null)`).
const USAGE = [
  { template_id: 'e1', campaign_key: 'life_conversion', kind: 'email' },
  { template_id: 'd1', campaign_key: 'life_conversion', kind: 'sms' },
  { template_id: 'c1', campaign_key: 'life_conversion', kind: 'ai_conversation' },
  { template_id: 'x1', campaign_key: 'cross_sell_life', kind: 'sms' },
  { template_id: 'xa1', campaign_key: 'cross_sell_life', kind: 'ai_conversation' },
  { template_id: 'w1', campaign_key: 'workshops', kind: 'email' },
]

const catalog = C.buildCatalog(TEMPLATES, USAGE)
const byId = (id) => catalog.find((r) => r.id === id)

t('AI conversation starters separate from plain SMS even though both are channel sms', () => {
  assert.equal(byId('c1').format, 'ai_conversation')
  assert.equal(byId('xa1').format, 'ai_conversation')
  assert.equal(byId('d1').format, 'sms')
  assert.equal(byId('x1').format, 'sms')
  assert.equal(byId('e1').format, 'email')
  // The touch kind is authoritative; the category suffix is only the unwired fallback.
  assert.equal(C.deriveFormat('sms', 'life_conversion', ['ai_conversation']), 'ai_conversation')
  assert.equal(C.deriveFormat('sms', 'life_conversion_ai', []), 'ai_conversation')
  assert.equal(C.deriveFormat('sms', 'policy_review', []), 'sms')
})

t('campaign membership comes from the catalog view, with the seed category map as fallback', () => {
  assert.deepEqual(byId('e1').campaigns, ['life_conversion'])
  assert.deepEqual(byId('w1').campaigns, ['workshops'])
  // Seeded for a campaign but not yet referenced by any touch row → still files under it.
  const unwired = C.buildCatalog([{ id: 'p1', name: 'Win-Back SMS', channel: 'sms', category: 'pipeline_winback', approval_status: 'draft', version: 1 }], [])
  assert.deepEqual(unwired[0].campaigns, ['pipeline_winback'])
})

t('templates no campaign references fall to the Template Library grouping', () => {
  assert.deepEqual(byId('l1').campaigns, [C.LIBRARY_KEY])
  assert.deepEqual(byId('l2').campaigns, [C.LIBRARY_KEY])
  assert.equal(C.campaignLabel(C.LIBRARY_KEY), 'Template Library')
  assert.equal(C.campaignLabel('life_conversion'), 'Life Conversion')
  assert.equal(C.campaignLabel('an_unknown_campaign'), 'an_unknown_campaign') // never blank
})

t('a template reused by two campaigns is listed under both and matches either filter', () => {
  const shared = C.buildCatalog(
    [{ id: 's1', name: 'Shared invite', channel: 'email', category: null, approval_status: 'approved', version: 1 }],
    [
      { template_id: 's1', campaign_key: 'life_conversion', kind: 'email' },
      { template_id: 's1', campaign_key: 'cross_sell_life', kind: 'email' },
    ],
  )
  assert.deepEqual(shared[0].campaigns, ['life_conversion', 'cross_sell_life']) // stable display order
  assert.equal(C.filterCatalog(shared, { campaign: 'life_conversion' }).length, 1)
  assert.equal(C.filterCatalog(shared, { campaign: 'cross_sell_life' }).length, 1)
  assert.equal(C.filterCatalog(shared, { campaign: 'pipeline_winback' }).length, 0)
})

t('filters compose: campaign + type narrows to that campaign group only', () => {
  const lc = C.filterCatalog(catalog, { campaign: 'life_conversion' })
  assert.deepEqual(lc.map((r) => r.id).sort(), ['c1', 'd1', 'e1'])

  const lcSms = C.filterCatalog(catalog, { campaign: 'life_conversion', format: 'sms' })
  assert.deepEqual(lcSms.map((r) => r.id), ['d1']) // the AI starter is NOT swept in
  const lcAi = C.filterCatalog(catalog, { campaign: 'life_conversion', format: 'ai_conversation' })
  assert.deepEqual(lcAi.map((r) => r.id), ['c1'])

  // No filter (or the explicit 'all' sentinel) is the whole library.
  assert.equal(C.filterCatalog(catalog, {}).length, TEMPLATES.length)
  assert.equal(C.filterCatalog(catalog, { format: C.ALL, campaign: C.ALL, q: '' }).length, TEMPLATES.length)
})

t('search matches name and category, case-insensitively, and composes with the axes', () => {
  assert.deepEqual(C.filterCatalog(catalog, { q: 'cross-sell' }).map((r) => r.id).sort(), ['x1', 'xa1'])
  assert.deepEqual(C.filterCatalog(catalog, { q: 'AD_HOC' }).map((r) => r.id), ['l1'])
  assert.deepEqual(C.filterCatalog(catalog, { q: 'life', format: 'ai_conversation' }).map((r) => r.id).sort(), ['c1', 'xa1'])
  assert.equal(C.filterCatalog(catalog, { q: '   ' }).length, TEMPLATES.length) // blank search is not a filter
})

t('facet counts honor the OTHER active filters, so no option advertises an empty view', () => {
  const all = C.facetCounts(catalog, {})
  const fmt = (f, v) => f.formats.find((x) => x.value === v).count
  const camp = (f, v) => f.campaigns.find((x) => x.value === v).count
  assert.equal(fmt(all, 'email'), 3)
  assert.equal(fmt(all, 'sms'), 3)
  assert.equal(fmt(all, 'ai_conversation'), 2)
  assert.equal(fmt(all, C.ALL), TEMPLATES.length)
  assert.equal(camp(all, 'life_conversion'), 3)
  assert.equal(camp(all, C.LIBRARY_KEY), 2)

  // With a campaign selected, the type counts describe THAT campaign.
  const inLc = C.facetCounts(catalog, { campaign: 'life_conversion' })
  assert.equal(fmt(inLc, 'email'), 1)
  assert.equal(fmt(inLc, 'sms'), 1)
  assert.equal(fmt(inLc, 'ai_conversation'), 1)
  // ...and the campaign counts are NOT narrowed by the campaign filter itself.
  assert.equal(camp(inLc, 'cross_sell_life'), 2)

  // With a type selected, the campaign counts describe THAT type.
  const inAi = C.facetCounts(catalog, { format: 'ai_conversation' })
  assert.equal(camp(inAi, 'life_conversion'), 1)
  assert.equal(camp(inAi, 'workshops'), 0)
  assert.equal(inAi.matching, 2)
  assert.equal(inAi.total, TEMPLATES.length)
})

t('untrusted query params are coerced to "all" — a filter can never widen the view', () => {
  const known = C.campaignKeys(catalog)
  assert.equal(C.normalizeFormat('sms'), 'sms')
  assert.equal(C.normalizeFormat('ai_conversation'), 'ai_conversation')
  assert.equal(C.normalizeFormat('advisor_outreach'), C.ALL) // not a template type
  assert.equal(C.normalizeFormat(undefined), C.ALL)
  assert.equal(C.normalizeFormat("' or 1=1--"), C.ALL)
  assert.equal(C.normalizeCampaign('life_conversion', known), 'life_conversion')
  assert.equal(C.normalizeCampaign(C.LIBRARY_KEY, known), C.LIBRARY_KEY)
  assert.equal(C.normalizeCampaign('not_a_campaign', known), C.ALL)
  assert.equal(C.normalizeCampaign(null, known), C.ALL)
})

t('filtering is presentation only — it never changes a row\'s approval status', () => {
  // The send-time gate reads approval_status; the view filters must not touch it.
  for (const r of C.filterCatalog(catalog, { format: 'ai_conversation' })) {
    assert.equal(r.approval_status, TEMPLATES.find((x) => x.id === r.id).approval_status)
  }
})

console.log(`\n${cases} tests passed — template view filters`)
