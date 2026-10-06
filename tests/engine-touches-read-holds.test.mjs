// Follow-up R12a: a failed read of the campaign's touch definitions HOLDS the tick — it never marks
// every due enrollment completed. All four engines (Life, Win-Back, Cross-Sell, district nurture).
// Run: node tests/engine-touches-read-holds.test.mjs
import assert from 'node:assert/strict'
import { bundle, installDb } from './helpers/workshop-harness.mjs'
import { memDb } from './helpers/memdb.mjs'

const PAST = new Date(Date.now() - 3600_000).toISOString()
const ENGINES = [
  { name: 'Life', file: 'src/lib/life-campaign/tick.ts', fn: 'lifeCampaignTick', campaigns: 'life_campaigns', touches: 'life_campaign_touches', enrollments: 'life_campaign_enrollments', live: 'active',
    enrollment: { member_id: 'm1', policy_id: 'p1', household_id: 'h1' } },
  { name: 'Win-Back', file: 'src/lib/pipeline-winback/tick.ts', fn: 'pipelineWinbackTick', campaigns: 'pipeline_winback_campaigns', touches: 'pipeline_winback_touches', enrollments: 'pipeline_winback_enrollments', live: 'active',
    enrollment: { opportunity_id: 'o1', household_id: 'h1' } },
  { name: 'Cross-Sell', file: 'src/lib/cross-sell-life/tick.ts', fn: 'crossSellLifeTick', campaigns: 'xsell_life_campaigns', touches: 'xsell_life_campaign_touches', enrollments: 'xsell_life_campaign_enrollments', live: 'running',
    enrollment: { member_id: 'm1', household_id: 'h1' } },
  { name: 'District nurture', file: 'src/lib/district-nurture/tick.ts', fn: 'districtNurtureTick', campaigns: 'district_nurture_campaigns', touches: 'district_nurture_touches', enrollments: 'district_nurture_enrollments', live: 'active',
    enrollment: { contact_id: 'c1', agency_owner_id: 'ao1', email: 'a@example.com' } },
]

let passed = 0
const failed = []
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name) } catch (e) { failed.push(name); console.log('  ✗', name, '—', e.message) } }
console.log('A failed touch-definitions read holds every engine')
for (const e of ENGINES) {
  const mod = await bundle(e.file)
  await t(`${e.name}: enrollments stay live when the touches read errors`, async () => {
    const db = memDb({ failOn: (st) => st.table === e.touches && st.method === 'select' })
    installDb(db)
    db.seed(e.campaigns, [{ id: 'camp-1', status: 'active', version: 1, daily_enrollment_limit: 0, purpose: 'MARKETING' }])
    db.seed(e.enrollments, [{ id: 'enr-1', campaign_id: 'camp-1', status: e.live, current_touch_no: 0, next_touch_at: PAST, baseline_date: '2026-09-01', ...e.enrollment }])
    try { await mod[e.fn]() } catch { /* a throw is not a completion; the assertion below decides */ }
    const row = db.rows(e.enrollments).find((r) => r.id === 'enr-1')
    assert.equal(row.status, e.live, `${e.name}: a read error turned the enrollment ${row.status}`)
  })
}
if (failed.length) { console.error(`\n✗ ${failed.length} failed`); process.exit(1) }
console.log(`\nAll ${passed} assertions passed.`)
