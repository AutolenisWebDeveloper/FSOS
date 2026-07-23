// FNA calculation-engine proof (ADR-015, build instruction §3). Compiles the PURE
// engine (src/lib/fna/engine/**) standalone with tsc — decimal.js resolves from
// the project node_modules because the outDir sits under cwd — then exercises it
// with UNIT fixtures, HAND-VERIFIED GOLDEN cases, and PROPERTY-based invariants
// (fast-check). No live Supabase; deterministic (a fixed computedAt clock).
// Run: node tests/fna-engine.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import fc from 'fast-check'

const out = mkdtempSync(join(process.cwd(), '.fna-engine-out-'))
process.on('exit', () => {
  try {
    rmSync(out, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
})

// Compile the engine barrel; tsc emits the whole local .ts graph (money, types,
// assumptions, registry, formulas/*) but not node_modules, so the emitted code
// require()s decimal.js at runtime from the project's node_modules.
execSync(
  `npx tsc src/lib/fna/engine/index.ts --outDir ${out} ` +
    `--module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop`,
  { stdio: 'inherit' },
)

const require = createRequire(import.meta.url)
const E = require(join(out, 'index.js'))
const {
  DEFAULT_ASSUMPTIONS,
  futureValue,
  presentValue,
  cashFlow,
  netWorth,
  emergencyFund,
  lifeInsuranceNeed,
  coverageGap,
  disabilityExposure,
  retirementProjection,
  educationFunding,
  survivorIncome,
  debtPaydown,
  FORMULAS,
  ENGINE_VERSION,
} = E

const CTX = { computedAt: '2026-07-23T00:00:00.000Z' }

const results = []
function check(name, fn) {
  try {
    fn()
    results.push([name, 'PASS', ''])
  } catch (e) {
    results.push([name, 'FAIL', e.message])
  }
}
function approx(actual, expected, eps, msg) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ?? 'approx'}: expected ~${expected} (±${eps}), got ${actual}`,
  )
}
function envelope(res, id, version) {
  assert.equal(res.formula_id, id, 'formula_id')
  assert.equal(res.formula_version, version, 'formula_version')
  assert.equal(res.currency, 'USD', 'currency')
  assert.equal(res.rounding, 'ROUND_HALF_UP@2dp', 'rounding')
  assert.equal(res.computed_at, CTX.computedAt, 'computed_at echoed from ctx')
  assert.ok(Array.isArray(res.warnings), 'warnings array')
  assert.ok(Array.isArray(res.assumptions_used), 'assumptions_used array')
}

// ── Primitives ───────────────────────────────────────────────────────────────
check('FV lump sum (10k @6% ×10) = 17908.48', () => {
  const r = futureValue({ presentValue: 10000, ratePerPeriod: 0.06, periods: 10 }, CTX)
  envelope(r, 'future_value', '1.0.0')
  approx(r.output.futureValue, 17908.48, 0.01, 'FV lump')
})
check('FV ordinary annuity (1000/yr @5% ×3) = 3152.50', () => {
  const r = futureValue({ presentValue: 0, ratePerPeriod: 0.05, periods: 3, payment: 1000 }, CTX)
  assert.equal(r.output.futureValue, 3152.5)
})
check('FV at r=0 is linear (1000 + 100×5) = 1500', () => {
  const r = futureValue({ presentValue: 1000, ratePerPeriod: 0, periods: 5, payment: 100 }, CTX)
  assert.equal(r.output.futureValue, 1500)
})
check('PV lump (10k @6% ×10) = 5583.95', () => {
  const r = presentValue({ futureValue: 10000, ratePerPeriod: 0.06, periods: 10 }, CTX)
  approx(r.output.presentValue, 5583.95, 0.01, 'PV lump')
})
check('PV annuity (1000/yr @5% ×3) = 2723.25', () => {
  const r = presentValue({ payment: 1000, ratePerPeriod: 0.05, periods: 3 }, CTX)
  approx(r.output.presentValue, 2723.25, 0.01, 'PV annuity')
})
check('PV(FV(x)) round-trips to x', () => {
  const fv = futureValue({ presentValue: 12345.67, ratePerPeriod: 0.05, periods: 8 }, CTX)
  const pv = presentValue({ futureValue: fv.output.futureValue, ratePerPeriod: 0.05, periods: 8 }, CTX)
  approx(pv.output.presentValue, 12345.67, 0.01, 'PV∘FV')
})

// ── Cash flow ────────────────────────────────────────────────────────────────
check('cash flow surplus + savings rate', () => {
  const r = cashFlow({ monthlyIncome: 10000, monthlyExpenses: 7000 }, CTX)
  envelope(r, 'cash_flow', '1.0.0')
  assert.equal(r.output.monthlySurplus, 3000)
  assert.equal(r.output.annualSurplus, 36000)
  assert.equal(r.output.savingsRate, 0.3)
  assert.equal(r.output.isDeficit, false)
})
check('cash flow deficit flagged', () => {
  const r = cashFlow({ monthlyIncome: 5000, monthlyExpenses: 6000 }, CTX)
  assert.equal(r.output.monthlySurplus, -1000)
  assert.equal(r.output.isDeficit, true)
})
check('cash flow degrades (missing expenses → warning, not throw)', () => {
  const r = cashFlow({ monthlyIncome: 8000 }, CTX)
  assert.equal(r.output.monthlySurplus, 8000)
  assert.ok(r.missing_inputs.includes('monthlyExpenses'))
  assert.equal(r.confidence, 'medium')
  assert.ok(r.warnings.some((w) => w.code === 'missing_expenses'))
})

// ── Net worth ────────────────────────────────────────────────────────────────
check('net worth = assets − liabilities', () => {
  const r = netWorth(
    { assets: [{ label: 'home', amount: 500000 }, { label: 'cash', amount: 50000 }], liabilities: [{ label: 'mortgage', amount: 300000 }, { label: 'auto', amount: 20000 }] },
    CTX,
  )
  envelope(r, 'net_worth', '1.0.0')
  assert.equal(r.output.totalAssets, 550000)
  assert.equal(r.output.totalLiabilities, 320000)
  assert.equal(r.output.netWorth, 230000)
})

// ── Emergency fund ───────────────────────────────────────────────────────────
check('emergency fund target/shortfall (6mo assumption)', () => {
  const r = emergencyFund({ liquidAssets: 20000, monthlyEssentialExpenses: 5000 }, DEFAULT_ASSUMPTIONS, CTX)
  envelope(r, 'emergency_fund', '1.0.0')
  assert.equal(r.output.targetMonths, 6)
  assert.equal(r.output.targetAmount, 30000)
  assert.equal(r.output.monthsCovered, 4)
  assert.equal(r.output.shortfall, 10000)
  assert.equal(r.output.surplus, 0)
  assert.equal(r.output.isAdequate, false)
  // The assumption used is recorded and flagged.
  const ref = r.assumptions_used.find((a) => a.key === 'emergency_fund_months')
  assert.ok(ref && ref.is_assumption === true && ref.assumption_set_version === 'default-v1')
})
check('emergency fund override drops the assumption ref', () => {
  const r = emergencyFund({ liquidAssets: 90000, monthlyEssentialExpenses: 5000, targetMonthsOverride: 3 }, DEFAULT_ASSUMPTIONS, CTX)
  assert.equal(r.output.targetAmount, 15000)
  assert.equal(r.output.surplus, 75000)
  assert.equal(r.output.isAdequate, true)
  assert.equal(r.assumptions_used.length, 0)
})

// ── Life insurance (both methods labeled) ────────────────────────────────────
check('life insurance income-replacement + capital-needs, both labeled', () => {
  const r = lifeInsuranceNeed(
    { annualIncome: 100000, existingCoverage: 200000, yearsToReplaceOverride: 10, totalDebts: 250000, educationFundNeed: 100000, emergencyFundNeed: 30000, liquidAssetsAvailable: 50000 },
    DEFAULT_ASSUMPTIONS,
    CTX,
  )
  envelope(r, 'life_insurance_need', '1.0.0')
  approx(r.output.realRate, 0.029126, 0.0001, 'life real rate')
  assert.equal(r.output.incomeReplacement.method, 'income_replacement')
  assert.equal(r.output.capitalNeeds.method, 'capital_needs')
  approx(r.output.incomeReplacement.grossNeed, 856910, 300, 'income-replacement gross')
  // capital-needs gross = finalExpenses(15000)+debts+edu+emergency + income capital
  approx(
    r.output.capitalNeeds.grossNeed,
    15000 + 250000 + 100000 + 30000 + r.output.incomeReplacement.grossNeed,
    0.02,
    'capital-needs gross internal consistency',
  )
  // additional need nets existing coverage / resources.
  approx(r.output.incomeReplacement.additionalNeed, r.output.incomeReplacement.grossNeed - 200000, 0.02, 'income additional')
  approx(r.output.capitalNeeds.additionalNeed, r.output.capitalNeeds.grossNeed - 50000 - 200000, 0.02, 'capital additional')
})
check('life insurance never negative; over-insured → 0 additional', () => {
  const r = lifeInsuranceNeed({ annualIncome: 50000, existingCoverage: 5000000, yearsToReplaceOverride: 10 }, DEFAULT_ASSUMPTIONS, CTX)
  assert.equal(r.output.incomeReplacement.additionalNeed, 0)
  assert.equal(r.output.capitalNeeds.additionalNeed, 0)
})

// ── Coverage gap ─────────────────────────────────────────────────────────────
check('coverage inventory & gap by type', () => {
  const r = coverageGap(
    { coverage: [{ label: 'term', type: 'life', faceAmount: 250000 }, { label: 'group', type: 'life', faceAmount: 100000 }], recommendedNeed: 600000 },
    CTX,
  )
  envelope(r, 'coverage_gap', '1.0.0')
  assert.equal(r.output.totalCoverage, 350000)
  assert.equal(r.output.gap, 250000)
  assert.equal(r.output.surplus, 0)
  assert.equal(r.output.byType.life, 350000)
  assert.equal(r.output.isAdequate, false)
})

// ── Disability ───────────────────────────────────────────────────────────────
check('disability exposure (60% assumption)', () => {
  const r = disabilityExposure({ monthlyIncome: 10000, existingMonthlyBenefit: 3000 }, DEFAULT_ASSUMPTIONS, CTX)
  envelope(r, 'disability_exposure', '1.0.0')
  assert.equal(r.output.targetMonthlyBenefit, 6000)
  assert.equal(r.output.monthlyGap, 3000)
  assert.equal(r.output.annualGap, 36000)
  assert.equal(r.output.isAdequate, false)
})

// ── Retirement (golden + internal consistency) ───────────────────────────────
check('retirement projection golden (age 40→65, live to 90)', () => {
  const r = retirementProjection(
    { currentAge: 40, retirementAgeOverride: 65, lifeExpectancyOverride: 90, currentSavings: 100000, annualContribution: 12000, desiredAnnualIncome: 60000, otherAnnualIncome: 20000 },
    DEFAULT_ASSUMPTIONS,
    CTX,
  )
  envelope(r, 'retirement_projection', '1.0.0')
  assert.equal(r.output.yearsToRetirement, 25)
  assert.equal(r.output.yearsInRetirement, 25)
  approx(r.output.projectedSavingsAtRetirement, 1087561, 500, 'projected savings')
  approx(r.output.capitalNeededAtRetirement, 1851159, 3000, 'capital needed')
  // shortfall is exactly max(0, capitalNeeded − projected) of the RETURNED values.
  approx(
    r.output.shortfall,
    Math.max(0, r.output.capitalNeededAtRetirement - r.output.projectedSavingsAtRetirement),
    0.02,
    'shortfall consistency',
  )
  assert.equal(r.output.onTrack, false)
})

// ── Education ────────────────────────────────────────────────────────────────
check('education funding shortfall (10y out, 4y @30k today)', () => {
  const r = educationFunding({ yearsUntilCollege: 10, yearsOfCollege: 4, annualCostToday: 30000, currentSavings: 20000, annualContribution: 2000 }, DEFAULT_ASSUMPTIONS, CTX)
  envelope(r, 'education_funding', '1.0.0')
  assert.ok(r.output.capitalNeededAtStart > 0)
  assert.ok(r.output.totalProjectedCost >= r.output.capitalNeededAtStart, 'nominal total ≥ discounted capital')
  approx(r.output.shortfall, Math.max(0, r.output.capitalNeededAtStart - r.output.projectedSavingsAtStart), 0.02, 'edu shortfall consistency')
})

// ── Survivor income ──────────────────────────────────────────────────────────
check('survivor income capital need & gap', () => {
  const r = survivorIncome({ survivorAnnualNeed: 60000, survivorOtherIncome: 25000, yearsNeeded: 20, existingResources: 300000 }, DEFAULT_ASSUMPTIONS, CTX)
  envelope(r, 'survivor_income', '1.0.0')
  assert.equal(r.output.netAnnualNeed, 35000)
  assert.ok(r.output.capitalNeeded > 0)
  approx(r.output.gap, Math.max(0, r.output.capitalNeeded - 300000), 0.02, 'survivor gap consistency')
})

// ── Debt paydown ─────────────────────────────────────────────────────────────
check('debt paydown 20k @6% $400/mo ≈ 58 months', () => {
  const r = debtPaydown({ balance: 20000, annualRate: 0.06, monthlyPayment: 400 }, CTX)
  envelope(r, 'debt_paydown', '1.0.0')
  assert.equal(r.output.monthsToPayoff, 58)
  assert.equal(r.output.neverPaysOff, false)
  approx(r.output.totalInterest, 3072, 5, 'debt interest')
})
check('debt paydown r=0 is balance/payment', () => {
  const r = debtPaydown({ balance: 1200, annualRate: 0, monthlyPayment: 100 }, CTX)
  assert.equal(r.output.monthsToPayoff, 12)
  assert.equal(r.output.totalInterest, 0)
})
check('debt paydown payment below interest never pays off (warning, no throw)', () => {
  const r = debtPaydown({ balance: 100000, annualRate: 0.12, monthlyPayment: 500 }, CTX)
  assert.equal(r.output.neverPaysOff, true)
  assert.equal(r.output.monthsToPayoff, null)
  assert.ok(r.warnings.some((w) => w.code === 'payment_below_interest'))
})

// ── Determinism (ADR-015 §3) ─────────────────────────────────────────────────
check('same inputs → identical outputs (deep equal)', () => {
  const a = retirementProjection({ currentAge: 35, currentSavings: 50000, desiredAnnualIncome: 80000 }, DEFAULT_ASSUMPTIONS, CTX)
  const b = retirementProjection({ currentAge: 35, currentSavings: 50000, desiredAnnualIncome: 80000 }, DEFAULT_ASSUMPTIONS, CTX)
  assert.deepEqual(a, b)
})

// ── Assumptions are versioned + labeled (CLAUDE.md §4.3) ──────────────────────
check('every default assumption is flagged is_assumption', () => {
  assert.equal(DEFAULT_ASSUMPTIONS.version, 'default-v1')
  assert.ok(DEFAULT_ASSUMPTIONS.assumptions.length >= 12)
  assert.ok(DEFAULT_ASSUMPTIONS.assumptions.every((a) => a.is_assumption === true))
})
check('registry catalogs all formulas with versions', () => {
  assert.equal(ENGINE_VERSION, '1.0.0')
  assert.ok(FORMULAS.length >= 12)
  assert.ok(FORMULAS.every((f) => f.id && f.version && f.label && Array.isArray(f.inputs)))
})

// ── Property-based invariants (fast-check) ───────────────────────────────────
const money = () => fc.integer({ min: 0, max: 5_000_000 })
check('property: net worth = ΣassetsΣ − Σliabilities', () => {
  fc.assert(
    fc.property(fc.array(money(), { maxLength: 8 }), fc.array(money(), { maxLength: 8 }), (as, ls) => {
      const r = netWorth({ assets: as.map((a) => ({ label: 'a', amount: a })), liabilities: ls.map((l) => ({ label: 'l', amount: l })) }, CTX)
      const ta = as.reduce((x, y) => x + y, 0)
      const tl = ls.reduce((x, y) => x + y, 0)
      return r.output.totalAssets === ta && r.output.totalLiabilities === tl && r.output.netWorth === ta - tl
    }),
    { numRuns: 200 },
  )
})
check('property: doubling income never reduces cash-flow surplus', () => {
  fc.assert(
    fc.property(money(), money(), (inc, exp) => {
      const base = cashFlow({ monthlyIncome: inc, monthlyExpenses: exp }, CTX).output.monthlySurplus
      const doubled = cashFlow({ monthlyIncome: inc * 2, monthlyExpenses: exp }, CTX).output.monthlySurplus
      return doubled >= base
    }),
    { numRuns: 200 },
  )
})
check('property: FV non-decreasing in periods for non-negative flows', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 200000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 40 }), (pv, pmt, n) => {
      const a = futureValue({ presentValue: pv, ratePerPeriod: 0.05, periods: n, payment: pmt }, CTX).output.futureValue
      const b = futureValue({ presentValue: pv, ratePerPeriod: 0.05, periods: n + 1, payment: pmt }, CTX).output.futureValue
      return b >= a - 0.01
    }),
    { numRuns: 200 },
  )
})
check('property: a larger retirement income goal never yields a smaller need', () => {
  fc.assert(
    fc.property(fc.integer({ min: 20000, max: 300000 }), (goal) => {
      const lo = retirementProjection({ currentAge: 40, desiredAnnualIncome: goal }, DEFAULT_ASSUMPTIONS, CTX).output.capitalNeededAtRetirement
      const hi = retirementProjection({ currentAge: 40, desiredAnnualIncome: goal + 10000 }, DEFAULT_ASSUMPTIONS, CTX).output.capitalNeededAtRetirement
      return hi >= lo - 0.01
    }),
    { numRuns: 150 },
  )
})
check('property: rounding never compounds (Σmoney(parts) within N¢ of money(Σparts))', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 100000000 }).map((c) => c / 100), { minLength: 1, maxLength: 20 }), (parts) => {
      const r = netWorth({ assets: parts.map((p) => ({ label: 'a', amount: p })), liabilities: [] }, CTX)
      const sumOfRounded = parts.reduce((x, y) => x + y, 0)
      return Math.abs(r.output.totalAssets - sumOfRounded) <= parts.length * 0.01
    }),
    { numRuns: 200 },
  )
})

// ── Report ───────────────────────────────────────────────────────────────────
const width = Math.max(...results.map((r) => r[0].length))
console.log('\nFNA calculation-engine proof\n' + '─'.repeat(width + 14))
for (const [name, status, detail] of results) {
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${name.padEnd(width)}  ${status}${detail ? '  — ' + detail : ''}`)
}
const failed = results.filter((r) => r[1] === 'FAIL')
console.log('─'.repeat(width + 14))
console.log(`${results.length - failed.length}/${results.length} passed\n`)
if (failed.length) process.exit(1)
