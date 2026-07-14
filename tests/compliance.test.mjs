// Standalone test harness (no test-runner dep) for GDC tier selection.
// Run: node tests/compliance.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-compliance-'))
execSync(
  `npx tsc src/lib/compliance.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { getTier, GDC_TIERS } = require(join(out, 'compliance.js'))

let passed = 0
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name) }

console.log('GDC tier selection')
await t('floor of each band maps to the right rate', () => {
  assert.equal(getTier(0).rate, 0.40)
  assert.equal(getTier(15000).rate, 0.60)
  assert.equal(getTier(55000).rate, 0.80)
})
await t('just below each breakpoint stays in the lower tier', () => {
  assert.equal(getTier(14999.99).rate, 0.40)
  assert.equal(getTier(54999.99).rate, 0.60)
})
await t('no gap: fractional dollars between old inclusive bounds resolve correctly', () => {
  // Regression: these values previously matched NO tier and fell back to 40%.
  assert.equal(getTier(14999.5).rate, 0.40)
  assert.equal(getTier(54999.5).rate, 0.60)
})
await t('float accumulation error at a boundary does not demote a tier', () => {
  // A true $55,000.00 summed in float can arrive as 54999.9999998.
  assert.equal(getTier(54999.9999998).rate, 0.80)
  assert.equal(getTier(14999.9999998).rate, 0.60)
})
await t('large and edge inputs are handled', () => {
  assert.equal(getTier(1_000_000).rate, 0.80)
  assert.equal(getTier(-5).rate, 0.40)       // negative clamps to Tier 1
  assert.equal(getTier(NaN).rate, 0.40)      // non-finite clamps to Tier 1
})
await t('every tier is reachable and bands are contiguous', () => {
  assert.equal(GDC_TIERS.length, 3)
  for (let i = 1; i < GDC_TIERS.length; i++) {
    assert.equal(GDC_TIERS[i].minGdc, GDC_TIERS[i - 1].maxGdc, 'no gap between tiers')
  }
})

console.log(`\nAll ${passed} assertions passed.`)
