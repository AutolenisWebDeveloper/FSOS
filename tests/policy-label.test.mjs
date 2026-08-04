// policyTypeLabel — the {{PolicyType}} label derived from a product's family + subtype.
// Pure; compiled offline with tsc. Run: node tests/policy-label.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-polabel-'))
execSync(`npx tsc src/lib/policy-label.ts --outDir ${out} --module commonjs --target es2020 --skipLibCheck`, { stdio: 'inherit' })
const { policyTypeLabel } = createRequire(import.meta.url)(join(out, 'policy-label.js'))

let passed = 0
const t = (name, fn) => { fn(); passed++; console.log('  ✓', name) }

t('builds a titled "subtype family" label', () => {
  assert.equal(policyTypeLabel('life', 'term'), 'Term Life')
  assert.equal(policyTypeLabel('Life', 'Whole'), 'Whole Life')
})
t('uses whichever part is present', () => {
  assert.equal(policyTypeLabel('life', null), 'Life')
  assert.equal(policyTypeLabel(null, 'term'), 'Term')
})
t('returns null when both are empty (never guesses — {{PolicyType}} fails closed)', () => {
  assert.equal(policyTypeLabel(null, null), null)
  assert.equal(policyTypeLabel('', '  '), null)
})

console.log(`\n✓ policy-label: ${passed} assertions passed`)
