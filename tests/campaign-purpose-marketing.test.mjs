// Life Conversion and Cross-Sell Life dispatch as MARKETING (owner decisions 6 and 10).
// Static invariants over the dispatch call sites — the established pattern for an architectural
// rule (cf. tests/ai-gateway-seam.test.mjs) — plus the migration that aligns the stored rows.
// Audit D-01 (POLICY_DEADLINE skipped business suppression) / E-07 (invalid purpose).
// Run: node tests/campaign-purpose-marketing.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }
const src = (p) => readFileSync(p, 'utf8')
const dispatchPurpose = (file) => {
  const s = src(file)
  const call = s.slice(s.indexOf('campaignDispatchContext({'), s.indexOf('})', s.indexOf('campaignDispatchContext({')))
  return call
}

console.log('Life Conversion and Cross-Sell Life are marketing at the gate')
t('Life Conversion tick dispatches with purpose MARKETING (not the stored POLICY_DEADLINE)', () => {
  const call = dispatchPurpose('src/lib/life-campaign/tick.ts')
  assert.match(call, /purpose: 'MARKETING'/)
  assert.doesNotMatch(call, /purpose: cfg\.purpose/)
})
t('Cross-Sell Life tick dispatches with purpose MARKETING (not the invalid stored value)', () => {
  const call = dispatchPurpose('src/lib/cross-sell-life/tick.ts')
  assert.match(call, /purpose: 'MARKETING'/)
  assert.doesNotMatch(call, /purpose: cfg\.purpose/)
})
t('Cross-Sell Life settings reject any purpose other than MARKETING', () => {
  assert.match(src('src/lib/cross-sell-life/controls.ts'), /clean\.purpose !== 'MARKETING'\) return \{ ok: false, error: 'purpose_must_be_marketing' \}/)
})
t('MARKETING is a valid MessagePurpose that gets the floor, the Sunday hold and business suppression', () => {
  const purpose = src('src/lib/comms/purpose.ts')
  assert.match(purpose, /'MARKETING'/)
  assert.doesNotMatch(src('src/lib/comms/suppression.ts').match(/TRANSACTIONAL_PURPOSES[^\]]*\]/)?.[0] ?? '', /'MARKETING'/)
})
t('migration 139 aligns the stored rows and defaults, with a documented rollback', () => {
  const m = src('supabase/migrations/139_campaign_purpose_marketing.sql')
  assert.match(m, /alter table life_campaigns alter column purpose set default 'MARKETING'/)
  assert.match(m, /alter table xsell_life_campaigns alter column purpose set default 'MARKETING'/)
  assert.match(m, /-- ROLLBACK:/)
  assert.doesNotMatch(m.replace(/^--.*$/gm, ''), /\b(delete from|drop table|truncate)\b/i)
})
console.log(`\nAll ${passed} assertions passed.`)
