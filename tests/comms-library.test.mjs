// Slice 8 (§17) — Campaign library. Proves the PURE catalog offline: every pre-built
// blueprint is compliance-ready (green-zone, no recommendation language, valid purpose /
// category / channel) and claim-bearing blueprints declare their claim fields (for §18
// data-confidence wiring). No DB, no network. Run: node tests/comms-library.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-library-'))
execSync(
  `npx tsc src/lib/comms/library.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { CAMPAIGN_BLUEPRINTS, listBlueprints, getBlueprint, blueprintToTemplateDraft } = require(join(out, 'comms/library.js'))
const { MESSAGE_PURPOSES } = require(join(out, 'comms/purpose.js'))
const { containsRecommendationLanguage } = require(join(out, 'compliance/guardrail.js'))

const CATEGORIES = ['appointment', 'referral', 'agency', 'term_conversion', 'policy_review', 'event', 'educational']
let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

console.log('Campaign library catalog integrity')

t('the catalog is non-empty and listBlueprints returns it', () => {
  assert.ok(Array.isArray(CAMPAIGN_BLUEPRINTS) && CAMPAIGN_BLUEPRINTS.length >= 5)
  assert.equal(listBlueprints().length, CAMPAIGN_BLUEPRINTS.length)
})

t('every blueprint key is unique', () => {
  const keys = CAMPAIGN_BLUEPRINTS.map((b) => b.key)
  assert.equal(new Set(keys).size, keys.length)
})

t('every blueprint has a valid channel, purpose, and category', () => {
  for (const b of CAMPAIGN_BLUEPRINTS) {
    assert.ok(['sms', 'email'].includes(b.channel), `${b.key} channel`)
    assert.ok(MESSAGE_PURPOSES.includes(b.purpose), `${b.key} purpose ${b.purpose}`)
    assert.ok(CATEGORIES.includes(b.category), `${b.key} category ${b.category}`)
    assert.ok(typeof b.name === 'string' && b.name.length > 0, `${b.key} name`)
    assert.ok(typeof b.description === 'string' && b.description.length > 0, `${b.key} description`)
  }
})

console.log('Compliance of pre-built content (green-zone only)')

t('NO blueprint body contains individualized recommendation / call-to-action language (§2.2)', () => {
  for (const b of CAMPAIGN_BLUEPRINTS) {
    assert.equal(containsRecommendationLanguage(b.body), false, `${b.key} body must be recommendation-free`)
    assert.ok(b.body.trim().length > 0, `${b.key} body non-empty`)
  }
})

t('claim-bearing blueprints declare at least one claim field (for §18 data-confidence)', () => {
  for (const b of CAMPAIGN_BLUEPRINTS) {
    if (b.makesSpecificClaims) {
      assert.ok(Array.isArray(b.claimFields) && b.claimFields.length > 0, `${b.key} must declare claimFields`)
    } else {
      assert.ok(!b.claimFields || b.claimFields.length === 0, `${b.key} declares claims but makesSpecificClaims=false`)
    }
  }
})

t('at least one claim-bearing and one non-claim blueprint exist (both paths covered)', () => {
  assert.ok(CAMPAIGN_BLUEPRINTS.some((b) => b.makesSpecificClaims))
  assert.ok(CAMPAIGN_BLUEPRINTS.some((b) => !b.makesSpecificClaims))
})

console.log('Selectors')

t('getBlueprint returns a known blueprint and undefined for an unknown key', () => {
  const first = CAMPAIGN_BLUEPRINTS[0]
  assert.equal(getBlueprint(first.key)?.key, first.key)
  assert.equal(getBlueprint('nope-not-a-key'), undefined)
})

t('blueprintToTemplateDraft yields a valid draft-template shape (name/channel/category/body)', () => {
  const d = blueprintToTemplateDraft(CAMPAIGN_BLUEPRINTS[0])
  assert.ok(d.name && d.channel && d.category && d.body)
  assert.ok(['sms', 'email'].includes(d.channel))
  assert.ok(CATEGORIES.includes(d.category))
  assert.equal(containsRecommendationLanguage(d.body), false)
})

console.log(`\n${passed} assertions passed.`)
