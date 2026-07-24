// FNA calculation-orchestrator proof (ADR-015/016, Slice 3). Compiles the PURE
// orchestrator (src/lib/fna/calculate.ts → plan-types + engine) standalone and
// asserts: plan-type analyses run, results carry formula+version, completeness is
// scored, and incomplete data degrades (fewer analyses / lower confidence) instead
// of throwing. Offline — outDir under cwd so decimal.js resolves.
// Run: node tests/fna-calculate.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-calc-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(
  `npx tsc src/lib/fna/calculate.ts src/lib/fna/plan-types.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)
const require = createRequire(import.meta.url)
const { calculatePlan, normalizeInputs } = require(join(out, 'calculate.js'))
const { DEFAULT_ASSUMPTIONS } = require(join(out, 'engine/index.js'))
const { planTypeDef, PLAN_TYPES } = require(join(out, 'plan-types.js'))

const CTX = { computedAt: '2026-07-24T00:00:00.000Z' }
const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

const fullExpress = {
  monthly_income: 10000,
  monthly_expenses: 7000,
  monthly_essential_expenses: 5000,
  total_assets: 550000,
  liquid_assets: 20000,
  total_liabilities: 320000,
  total_debt: 300000,
  existing_life_coverage: 200000,
  existing_disability_monthly: 3000,
}

check('registry exposes express + comprehensive', () => {
  assert.ok(planTypeDef('express'))
  assert.ok(planTypeDef('comprehensive'))
  assert.ok(PLAN_TYPES.length >= 4)
})

check('normalizeInputs keeps only finite numerics', () => {
  const v = normalizeInputs([
    { key: 'monthly_income', value_numeric: 10000 },
    { key: 'note', value_numeric: null },
    { key: 'bad', value_numeric: Infinity },
  ])
  assert.equal(v.monthly_income, 10000)
  assert.ok(!('note' in v))
  assert.ok(!('bad' in v))
})

check('express runs its six analyses on complete data', () => {
  const calc = calculatePlan('express', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  const ids = calc.results.map((r) => r.formula_id).sort()
  assert.deepEqual(ids, ['cash_flow', 'coverage_gap', 'disability_exposure', 'emergency_fund', 'life_insurance_need', 'net_worth'])
  assert.equal(calc.completeness, 1)
  assert.equal(calc.missingFields.length, 0)
  // Every result carries a formula id + version + envelope.
  for (const r of calc.results) {
    assert.ok(r.formula_id && r.formula_version, 'formula id+version present')
    assert.equal(r.envelope.currency, 'USD')
  }
})

check('cash-flow surplus is correct through the orchestrator', () => {
  const calc = calculatePlan('express', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  const cf = calc.results.find((r) => r.formula_id === 'cash_flow')
  assert.equal(cf.envelope.output.monthlySurplus, 3000)
})

check('coverage-gap need is fed by the life income-replacement gross', () => {
  const calc = calculatePlan('express', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  const life = calc.results.find((r) => r.formula_id === 'life_insurance_need')
  const gap = calc.results.find((r) => r.formula_id === 'coverage_gap')
  assert.equal(gap.envelope.output.recommendedNeed, life.envelope.output.incomeReplacement.grossNeed)
})

check('incomplete express still produces output (degrades, never throws)', () => {
  const calc = calculatePlan('express', { monthly_income: 8000 }, DEFAULT_ASSUMPTIONS, CTX)
  assert.ok(calc.results.length >= 5, 'analyses still run on partial data')
  assert.ok(calc.completeness < 1)
  assert.ok(calc.missingFields.includes('total_assets'))
  // A result with missing inputs is lower confidence, not an error.
  const cf = calc.results.find((r) => r.formula_id === 'cash_flow')
  assert.notEqual(cf.confidence, 'high')
})

check('comprehensive adds retirement/education/survivor when those inputs present', () => {
  const values = {
    ...fullExpress,
    current_age: 40,
    desired_annual_income: 60000,
    current_retirement_savings: 100000,
    annual_retirement_contribution: 12000,
    other_annual_income: 20000,
    years_until_college: 10,
    annual_college_cost_today: 30000,
    education_current_savings: 20000,
    education_annual_contribution: 2000,
    survivor_annual_need: 60000,
    survivor_years_needed: 20,
  }
  const calc = calculatePlan('comprehensive', values, DEFAULT_ASSUMPTIONS, CTX)
  const ids = calc.results.map((r) => r.formula_id)
  assert.ok(ids.includes('retirement_projection'))
  assert.ok(ids.includes('education_funding'))
  assert.ok(ids.includes('survivor_income'))
  assert.equal(calc.completeness, 1)
})

check('comprehensive omits retirement analysis when its inputs are absent', () => {
  const calc = calculatePlan('comprehensive', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  const ids = calc.results.map((r) => r.formula_id)
  assert.ok(!ids.includes('retirement_projection'), 'no age/goal → no retirement projection')
  assert.ok(calc.completeness < 1)
})

check('determinism: same inputs → identical results', () => {
  const a = calculatePlan('express', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  const b = calculatePlan('express', fullExpress, DEFAULT_ASSUMPTIONS, CTX)
  assert.deepEqual(a, b)
})

const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA calculation-orchestrator proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
}
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
