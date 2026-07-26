// tests/segments.test.mjs — Slice 5 (contact segmentation) pure rule engine.
// Proves membership matching, completeness, the three campaign presets, and the
// eligible/excluded-with-reasons classification the preview surfaces.
// Run with: node tests/segments.test.mjs  (esbuild-bundled like resolution.test.mjs)

import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let m
try {
  const dir = mkdtempSync(join(tmpdir(), 'seg-'))
  const out = join(dir, 'mod.mjs')
  execSync(`npx --yes esbuild@0.21.5 src/lib/segments/rules.ts --bundle --platform=node --format=esm --packages=external --outfile=${out}`, { stdio: 'ignore' })
  m = await import(out)
  rmSync(dir, { recursive: true, force: true })
} catch (e) {
  if (process.env.CI_REQUIRE_INFRA === '1') { console.error('FAIL: CI_REQUIRE_INFRA=1 but esbuild unavailable:', e.message); process.exit(1) }
  console.log('segments.test.mjs — SKIPPED (esbuild unavailable):', e.message); process.exit(0)
}
const { computeCompleteness, matchesRule, classifyEligibility, SEGMENT_PRESETS, ruleForPreset } = m

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }

console.log('segments — completeness')
ok(computeCompleteness({ full_name: 'A B', email: 'a@x.com', phone: '5551234567', household_id: 'h', contact_type: 'client', state: 'TX' }) === 1, 'all six fields → 1.0')
ok(computeCompleteness({ full_name: 'Unnamed contact', contact_type: 'unknown' }) === 0, 'placeholder name + unknown type → 0')
ok(Math.abs(computeCompleteness({ full_name: 'A B', email: 'a@x.com', contact_type: 'client' }) - 3 / 6) < 1e-9, 'name+email+type → 0.5')

console.log('segments — membership matching')
const base = { id: 'c', full_name: 'Al Smith', contact_type: 'prospect', tags: ['vip'], source: 'import:csv', state: 'TX', status: 'active' }
ok(matchesRule(base, { base: 'contacts', contactTypes: ['prospect', 'client'] }), 'contact_type in list matches')
ok(!matchesRule(base, { base: 'contacts', contactTypes: ['client'] }), 'contact_type not in list excluded')
ok(matchesRule(base, { base: 'contacts', tagsAny: ['vip'] }), 'tag overlap matches')
ok(!matchesRule(base, { base: 'contacts', tagsAny: ['gold'] }), 'no tag overlap excluded')
ok(matchesRule(base, { base: 'contacts', sources: ['import:csv'] }), 'source in list matches')
ok(matchesRule(base, { base: 'contacts', states: ['tx'] }), 'state match is case-insensitive')
ok(!matchesRule(base, { base: 'contacts', ownerScope: 'u9' }), 'owner_scope mismatch excluded')
ok(!matchesRule({ ...base, status: 'archived' }, { base: 'contacts' }), 'archived contact never a member')

console.log('segments — win-back either source OR tag')
const wb = SEGMENT_PRESETS.win_back.rule
ok(matchesRule({ id: '1', source: 'winback_life', status: 'active' }, wb), 'winback source alone matches')
ok(matchesRule({ id: '2', tags: ['life-winback'], status: 'active' }, wb), 'life-winback tag alone matches')
ok(!matchesRule({ id: '3', source: 'import', tags: ['vip'], status: 'active' }, wb), 'neither source nor tag → not win-back')

console.log('segments — presets')
ok(SEGMENT_PRESETS.cross_sell.householdSignal === 'cross_sell_gaps', 'cross_sell consults cross_sell_gaps view')
ok(SEGMENT_PRESETS.life_conversion.householdSignal === 'conversions_due', 'life_conversion consults conversions_due view')
ok(SEGMENT_PRESETS.win_back.householdSignal === null, 'win_back needs no household view')
ok(ruleForPreset('cross_sell', { channel: 'sms' }).channel === 'sms', 'ruleForPreset applies overrides')

console.log('segments — eligibility classification + reasons')
const full = { id: 'c', full_name: 'Al Smith', email: 'a@x.com', phone: '5551234567', household_id: 'h', contact_type: 'client', state: 'TX' }
const goodSignals = { hasMember: true, hasConsent: true, suppressed: false }
ok(classifyEligibility(full, { base: 'contacts', channel: 'email' }, goodSignals).eligible, 'complete + member + consent + not suppressed → eligible')

const noHh = classifyEligibility({ ...full, household_id: null }, { base: 'contacts' }, { ...goodSignals, hasMember: false })
ok(!noHh.eligible && noHh.reasons.includes('no_household'), 'no household → excluded (no_household)')

const noConsent = classifyEligibility(full, { base: 'contacts' }, { ...goodSignals, hasConsent: false })
ok(!noConsent.eligible && noConsent.reasons.includes('no_consent'), 'no granted consent → excluded (no_consent)')

const suppressed = classifyEligibility(full, { base: 'contacts' }, { ...goodSignals, suppressed: true })
ok(suppressed.reasons.includes('suppressed'), 'do_not_contact/DNC/revoked → excluded (suppressed)')

const noMethodSms = classifyEligibility({ ...full, phone: null }, { base: 'contacts', channel: 'sms' }, goodSignals)
ok(noMethodSms.reasons.includes('no_contact_method'), 'sms channel + no phone → no_contact_method')

const incomplete = classifyEligibility({ id: 'c', full_name: 'Al Smith', email: 'a@x.com', household_id: 'h', contact_type: 'client' }, { base: 'contacts', channel: 'email', minCompleteness: 0.9 }, goodSignals)
ok(incomplete.reasons.includes('incomplete'), 'below completeness threshold → incomplete')

const multi = classifyEligibility({ ...full, household_id: null, email: null }, { base: 'contacts', channel: 'email' }, { hasMember: false, hasConsent: false, suppressed: true })
ok(multi.reasons.length >= 3 && !multi.eligible, 'multiple failures collect multiple reasons')

console.log(`\n${pass} passed, ${fail} failed.`)
if (fail > 0) process.exit(1)
