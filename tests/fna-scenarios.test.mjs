// FNA scenario-engine proof (Slice 5, ADR-015/016). Compiles the PURE scenario
// engine (scenarios → calculate → plan-types → engine) standalone and asserts:
// overrides apply correctly (set / delta-floor / assumption), a scenario re-runs
// the deterministic orchestrator, retirement levers move the result the right way,
// and it is reproducible. Offline; outDir under cwd so decimal.js resolves.
// Run: node tests/fna-scenarios.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const out = mkdtempSync(join(process.cwd(), '.fna-scn-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

execSync(`npx tsc src/lib/fna/scenarios.ts src/lib/fna/plan-types.ts --outDir ${out} --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`, { stdio: 'inherit' })
const require = createRequire(import.meta.url)
const { applyOverride, computeScenario, SCENARIO_PRESETS, scenarioPreset } = require(join(out, 'scenarios.js'))
const { DEFAULT_ASSUMPTIONS } = require(join(out, 'engine/index.js'))

const CTX = { computedAt: '2026-07-24T00:00:00.000Z' }
const base = {
  monthly_income: 10000,
  monthly_expenses: 7000,
  monthly_essential_expenses: 5000,
  total_assets: 550000,
  liquid_assets: 20000,
  total_liabilities: 320000,
  existing_life_coverage: 200000,
  current_age: 40,
  desired_annual_income: 60000,
  current_retirement_savings: 100000,
  annual_retirement_contribution: 12000,
  other_annual_income: 20000,
}
function retShortfall(calc) {
  return calc.results.find((r) => r.formula_id === 'retirement_projection').envelope.output.shortfall
}

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}

check('presets are catalogued and looked up by type', () => {
  assert.ok(SCENARIO_PRESETS.length >= 8)
  assert.equal(scenarioPreset('retirement_age_70').override.assumptions.retirement_age, 70)
})

check('applyOverride: inputs set, deltas add and floor at 0, assumptions override', () => {
  const { values, assumptions } = applyOverride(
    { annual_retirement_contribution: 12000, monthly_expenses: 300 },
    DEFAULT_ASSUMPTIONS,
    { inputs: { monthly_income: 9000 }, inputDeltas: { annual_retirement_contribution: 6000, monthly_expenses: -500 }, assumptions: { retirement_age: 62 } },
  )
  assert.equal(values.monthly_income, 9000)
  assert.equal(values.annual_retirement_contribution, 18000)
  assert.equal(values.monthly_expenses, 0, 'delta floored at 0')
  assert.equal(assumptions.assumptions.find((a) => a.key === 'retirement_age').value, 62)
  assert.ok(assumptions.version.endsWith('+scenario'))
})

check('retiring later reduces the retirement shortfall', () => {
  const at62 = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('retirement_age_62').override, CTX)
  const at70 = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('retirement_age_70').override, CTX)
  assert.ok(retShortfall(at70) <= retShortfall(at62), 'later retirement ⇒ smaller (or equal) shortfall')
})

check('saving more reduces the retirement shortfall', () => {
  const baseCalc = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, {}, CTX)
  const more = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('increased_savings').override, CTX)
  assert.ok(retShortfall(more) <= retShortfall(baseCalc), 'more savings ⇒ smaller (or equal) shortfall')
})

check('market stress lowers projected savings', () => {
  const baseCalc = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, {}, CTX)
  const stress = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('market_stress').override, CTX)
  const p0 = baseCalc.results.find((r) => r.formula_id === 'retirement_projection').envelope.output.projectedSavingsAtRetirement
  const p1 = stress.results.find((r) => r.formula_id === 'retirement_projection').envelope.output.projectedSavingsAtRetirement
  assert.ok(p1 < p0, 'lower returns ⇒ lower projected savings')
})

check('scenario does not mutate the base inputs/assumptions', () => {
  const snapshot = JSON.stringify({ base, a: DEFAULT_ASSUMPTIONS })
  computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('high_inflation').override, CTX)
  assert.equal(JSON.stringify({ base, a: DEFAULT_ASSUMPTIONS }), snapshot, 'base data unchanged')
})

check('determinism: same scenario → identical results', () => {
  const a = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('long_life').override, CTX)
  const b = computeScenario('comprehensive', base, DEFAULT_ASSUMPTIONS, scenarioPreset('long_life').override, CTX)
  assert.deepEqual(a, b)
})

const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA scenario-engine proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
