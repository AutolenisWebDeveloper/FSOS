// FNA report-model proof (Slice 7). Compiles the PURE report model standalone and
// asserts row extraction (money/percent/nested), section assembly with formula
// version + confidence + assumptions + missing, and the verbatim FINRA disclosure.
// Run: node tests/fna-report.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-report-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})
// report.ts now imports the single FINRA_DISCLAIMER constant from lib/compliance,
// so compile both; tsc roots at src/lib and emits out/fna/report.js.
execSync(`npx tsc src/lib/fna/report.ts src/lib/compliance.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { extractReportRows, buildReportSections, REPORT_DISCLOSURE, formulaLabel } = require(join(out, 'fna/report.js'))

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

check('disclosure is the verbatim FINRA text', () => {
  assert.equal(
    REPORT_DISCLOSURE,
    'For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.',
  )
})

check('extractReportRows formats money, percent, boolean, and nested objects', () => {
  const rows = extractReportRows({ monthlySurplus: 3000, savingsRate: 0.3, isDeficit: false, incomeReplacement: { grossNeed: 850000 } })
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
  assert.equal(byLabel['Monthly Surplus'], '$3,000')
  assert.equal(byLabel['Savings Rate'], '30.0%')
  assert.equal(byLabel['Is Deficit'], 'No')
  assert.equal(byLabel['Income Replacement — Gross Need'], '$850,000')
})

check('monthlyIncomeMargin is money, not a percentage (regression: was rendering ×100%)', () => {
  const rows = extractReportRows({ monthlyIncomeMargin: 500, sustainableAnnualIncome: 60000 })
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
  assert.equal(byLabel['Monthly Income Margin'], '$500') // NOT "50000.0%"
  assert.equal(byLabel['Sustainable Annual Income'], '$60,000')
})

check('whole-percent, fraction-percent, and count fields render correctly', () => {
  const rows = extractReportRows({ targetReplacementPct: 60, fundedRatio: 1.2, assetCount: 3, liabilityCount: 2, monthsCovered: 4 })
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
  assert.equal(byLabel['Target Replacement Pct'], '60.0%') // already 0..100, NOT ×100
  assert.equal(byLabel['Funded Ratio'], '120.0%') // 0..1 fraction ×100
  assert.equal(byLabel['Asset Count'], '3') // integer, NOT "$3"
  assert.equal(byLabel['Liability Count'], '2')
  assert.equal(byLabel['Months Covered'], '4') // duration, NOT currency/percent
})

check('buildReportSections carries formula version, confidence, assumptions, missing', () => {
  const sections = buildReportSections([
    {
      formula_id: 'retirement_projection',
      formula_version: '1.0.0',
      confidence: 'medium',
      envelope: {
        output: { shortfall: 500000, onTrack: false },
        assumptions_used: [{ key: 'inflation_rate', value: 0.03, unit: 'rate' }],
        missing_inputs: ['other_annual_income'],
      },
    },
  ])
  assert.equal(sections.length, 1)
  assert.equal(sections[0].label, 'Retirement projection')
  assert.equal(sections[0].version, '1.0.0')
  assert.equal(sections[0].confidence, 'medium')
  assert.equal(sections[0].assumptions[0].value, '3.0%')
  assert.deepEqual(sections[0].missing, ['other_annual_income'])
  assert.ok(sections[0].rows.some((r) => r.label === 'Shortfall' && r.value === '$500,000'))
})

check('formulaLabel maps ids to friendly names', () => {
  assert.equal(formulaLabel('cash_flow'), 'Cash flow')
  assert.equal(formulaLabel('unknown_x'), 'unknown_x')
})

const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA report-model proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
