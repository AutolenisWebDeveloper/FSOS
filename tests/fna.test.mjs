// FNA Generator guardrail proof (docs/legacy-port.md §2.1 acceptance:
// "disclaimer present verbatim; a recommendation-bearing draft is blocked in
// test"). Compiles the PURE screen core (lib/fna/screen.ts + its guardrail/
// compliance deps) standalone and asserts the red line, with no live Supabase.
// Run: node tests/fna.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(tmpdir(), 'fsos-fna-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

// screen.ts pulls in compliance/guardrail.ts → compliance.ts. All pure.
execSync(
  `npx tsc src/lib/fna/screen.ts src/lib/compliance/guardrail.ts ` +
    `--outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const { screenFnaReport, withDisclaimer, fnaNarrativeText, FNA_DISCLAIMER } = require(join(out, 'fna/screen.js'))

// 1. The disclaimer is the exact FINRA text, verbatim.
assert.equal(
  FNA_DISCLAIMER,
  'For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.',
  'FNA disclaimer must match the FINRA text verbatim',
)

// 2. A clean, needs/gaps-only report with the disclaimer is allowed.
const clean = withDisclaimer({
  executive_summary: 'The household has a potential life-coverage gap relative to income.',
  financial_position: 'Protection posture is thin for a single-income household with dependents.',
  gaps: ['Life coverage gap: current coverage is below the 10x income benchmark'],
  recommendations: [
    { priority: 1, title: 'Life coverage gap review', description: 'Discuss the protection gap at the review.', product_category: 'Life Insurance' },
  ],
  next_steps: ['Schedule a review to discuss the coverage gap'],
})
assert.equal(screenFnaReport(clean).allow, true, 'clean needs/gaps report must be allowed')

// 3. A recommendation-bearing report is HARD BLOCKED.
const pushy = withDisclaimer({
  executive_summary: 'You should buy this whole-life policy to fix the gap.',
  gaps: ['Coverage gap'],
})
const pushyResult = screenFnaReport(pushy)
assert.equal(pushyResult.allow, false, 'recommendation language must block')
assert.ok(pushyResult.reasons.includes('recommendation'), 'block reason must be recommendation')

// 4. "We recommend" call-to-action in a next step is also blocked.
const recNextStep = withDisclaimer({
  executive_summary: 'Solid position.',
  next_steps: ['We recommend converting your term policy to permanent coverage now.'],
})
assert.equal(screenFnaReport(recNextStep).allow, false, 'recommendation in next_steps must block')

// 5. A report missing the disclaimer is blocked (defense in depth).
const noDisclaimer = { executive_summary: 'Fine.', gaps: ['Gap'] }
const ndResult = screenFnaReport(noDisclaimer)
assert.equal(ndResult.allow, false, 'missing disclaimer must block')
assert.ok(ndResult.reasons.includes('missing_disclaimer'), 'block reason must be missing_disclaimer')

// 6. Bare product CATEGORY labels are not treated as recommendation prose.
assert.ok(!fnaNarrativeText(clean).includes('Life Insurance'), 'product_category is excluded from screened narrative')

console.log('✓ fna.test.mjs — FNA disclaimer verbatim + recommendation red line enforced')
