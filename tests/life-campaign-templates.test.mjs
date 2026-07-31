// Life Conversion Campaign — §14 seed copy is green-zone. Reads the ACTUAL bodies from the
// seed migration (082) and asserts every one passes the same containsRecommendationLanguage
// guardrail the send gate applies (§4.2 / ADR-023) — a mechanical check that already exists,
// run before any template is considered "ready for approval". Also checks asset counts + that
// every SMS carries STOP language and only repo-native {{snake_case}} tokens are used.
// Run: node tests/life-campaign-templates.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-lcc-tpl-'))
execSync(
  `npx tsc src/lib/compliance/guardrail.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { containsRecommendationLanguage } = require(join(out, 'compliance/guardrail.js'))

const sql = readFileSync('supabase/migrations/082_life_conversion_seed.sql', 'utf8')

// Extract every $body$ … $body$ block (the template bodies).
const bodies = [...sql.matchAll(/\$body\$([\s\S]*?)\$body\$/g)].map((m) => m[1])

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('seeds exactly 18 message bodies (7 email + 6 SMS + 5 AI)', () => {
  assert.equal(bodies.length, 18)
})

t('every seeded body is green-zone — no recommendation language', () => {
  for (const b of bodies) {
    assert.equal(containsRecommendationLanguage(b), false, `recommendation language in: ${b.slice(0, 60)}…`)
  }
})

t('every SMS body carries STOP-to-opt-out language (§12)', () => {
  const smsBodies = [...sql.matchAll(/'sms', 'life_conversion',\s*\$body\$([\s\S]*?)\$body\$/g)].map((m) => m[1])
  assert.equal(smsBodies.length, 6)
  for (const b of smsBodies) assert.ok(/STOP/i.test(b), `SMS missing STOP: ${b.slice(0, 40)}`)
})

t('bodies use only repo-native {{snake_case}} merge tokens (resolve, never leak)', () => {
  const allowed = new Set(['first_name', 'fsa_name', 'agency_name', 'scheduling_link', 'advisor_phone', 'advisor_email'])
  for (const b of bodies) {
    for (const m of b.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
      assert.ok(allowed.has(m[1]), `unsupported token {{${m[1]}}}`)
    }
  }
})

t('all 20 touches are seeded with a template (or null for the 2 advisor touches)', () => {
  const touchRows = [...sql.matchAll(/'f1c00000-0000-4000-8000-000000000001',\s*(\d+),/g)]
  assert.equal(touchRows.length, 20)
})

console.log(`\n✓ life-campaign templates: ${passed} assertions passed`)
