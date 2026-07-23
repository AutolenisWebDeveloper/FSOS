// src/lib/fna/engine/registry.ts
// The FORMULA CATALOG — metadata for every calculation the engine exposes: stable
// id, current version, label, category, description, and input keys. This is the
// authoritative list the Formula Explorer (slice 9) renders and the data model
// (slice 2) references when linking a stored result to its formula. Keeping it
// declarative (not a heterogeneous dispatcher) matches the varied formula
// signatures while still giving one place to enumerate versions. Pure (ADR-015).

import { FUTURE_VALUE_ID, FUTURE_VALUE_VERSION } from './formulas/future-value'
import { PRESENT_VALUE_ID, PRESENT_VALUE_VERSION } from './formulas/present-value'
import { CASH_FLOW_ID, CASH_FLOW_VERSION } from './formulas/cash-flow'
import { NET_WORTH_ID, NET_WORTH_VERSION } from './formulas/net-worth'
import { EMERGENCY_FUND_ID, EMERGENCY_FUND_VERSION } from './formulas/emergency-fund'
import { LIFE_INSURANCE_ID, LIFE_INSURANCE_VERSION } from './formulas/life-insurance'
import { COVERAGE_GAP_ID, COVERAGE_GAP_VERSION } from './formulas/coverage-gap'
import { DISABILITY_ID, DISABILITY_VERSION } from './formulas/disability'
import { RETIREMENT_ID, RETIREMENT_VERSION } from './formulas/retirement'
import { EDUCATION_ID, EDUCATION_VERSION } from './formulas/education'
import { SURVIVOR_INCOME_ID, SURVIVOR_INCOME_VERSION } from './formulas/survivor-income'
import { DEBT_PAYDOWN_ID, DEBT_PAYDOWN_VERSION } from './formulas/debt-paydown'

/** Engine-wide version — bump when the catalog shape or default assumptions change. */
export const ENGINE_VERSION = '1.0.0'

export type FormulaCategory =
  | 'primitive'
  | 'cash_flow'
  | 'net_worth'
  | 'protection'
  | 'retirement'
  | 'education'

export interface FormulaMeta {
  id: string
  version: string
  label: string
  category: FormulaCategory
  description: string
  /** Whether the formula consumes the assumption-set. */
  usesAssumptions: boolean
  /** The named inputs the formula accepts (for the Formula Explorer). */
  inputs: string[]
}

export const FORMULAS: FormulaMeta[] = [
  {
    id: FUTURE_VALUE_ID,
    version: FUTURE_VALUE_VERSION,
    label: 'Future value',
    category: 'primitive',
    description: 'Future value of a lump sum plus an ordinary annuity.',
    usesAssumptions: false,
    inputs: ['presentValue', 'ratePerPeriod', 'periods', 'payment'],
  },
  {
    id: PRESENT_VALUE_ID,
    version: PRESENT_VALUE_VERSION,
    label: 'Present value',
    category: 'primitive',
    description: 'Present value of a future lump sum and of an ordinary annuity.',
    usesAssumptions: false,
    inputs: ['futureValue', 'payment', 'ratePerPeriod', 'periods'],
  },
  {
    id: CASH_FLOW_ID,
    version: CASH_FLOW_VERSION,
    label: 'Cash flow',
    category: 'cash_flow',
    description: 'Monthly income vs. expenses → surplus/deficit and savings rate.',
    usesAssumptions: false,
    inputs: ['monthlyIncome', 'monthlyExpenses'],
  },
  {
    id: NET_WORTH_ID,
    version: NET_WORTH_VERSION,
    label: 'Net worth',
    category: 'net_worth',
    description: 'Total assets less total liabilities.',
    usesAssumptions: false,
    inputs: ['assets', 'liabilities'],
  },
  {
    id: EMERGENCY_FUND_ID,
    version: EMERGENCY_FUND_VERSION,
    label: 'Emergency fund adequacy',
    category: 'cash_flow',
    description: 'Months of essential expenses covered vs. a target buffer.',
    usesAssumptions: true,
    inputs: ['liquidAssets', 'monthlyEssentialExpenses', 'targetMonthsOverride'],
  },
  {
    id: LIFE_INSURANCE_ID,
    version: LIFE_INSURANCE_VERSION,
    label: 'Life insurance need',
    category: 'protection',
    description: 'Income-replacement and capital-needs methods, both labeled, with gap.',
    usesAssumptions: true,
    inputs: ['annualIncome', 'existingCoverage', 'yearsToReplaceOverride', 'totalDebts', 'educationFundNeed', 'emergencyFundNeed', 'finalExpensesOverride', 'liquidAssetsAvailable'],
  },
  {
    id: COVERAGE_GAP_ID,
    version: COVERAGE_GAP_VERSION,
    label: 'Coverage inventory & gap',
    category: 'protection',
    description: 'Sum in-force coverage and compare to a recommended need.',
    usesAssumptions: false,
    inputs: ['coverage', 'recommendedNeed'],
  },
  {
    id: DISABILITY_ID,
    version: DISABILITY_VERSION,
    label: 'Disability income exposure',
    category: 'protection',
    description: 'Target income replacement vs. in-force disability benefit.',
    usesAssumptions: true,
    inputs: ['monthlyIncome', 'existingMonthlyBenefit', 'targetReplacementPctOverride'],
  },
  {
    id: RETIREMENT_ID,
    version: RETIREMENT_VERSION,
    label: 'Retirement projection',
    category: 'retirement',
    description: 'Projected savings vs. capital needed; shortfall/surplus.',
    usesAssumptions: true,
    inputs: ['currentAge', 'retirementAgeOverride', 'lifeExpectancyOverride', 'currentSavings', 'annualContribution', 'desiredAnnualIncome', 'otherAnnualIncome'],
  },
  {
    id: EDUCATION_ID,
    version: EDUCATION_VERSION,
    label: 'Education funding',
    category: 'education',
    description: 'Inflated cost stream vs. projected savings; shortfall.',
    usesAssumptions: true,
    inputs: ['yearsUntilCollege', 'yearsOfCollege', 'annualCostToday', 'currentSavings', 'annualContribution'],
  },
  {
    id: SURVIVOR_INCOME_ID,
    version: SURVIVOR_INCOME_VERSION,
    label: 'Survivor income',
    category: 'protection',
    description: 'Capital needed to fund a survivor income need less resources.',
    usesAssumptions: true,
    inputs: ['survivorAnnualNeed', 'survivorOtherIncome', 'yearsNeeded', 'existingResources'],
  },
  {
    id: DEBT_PAYDOWN_ID,
    version: DEBT_PAYDOWN_VERSION,
    label: 'Debt paydown',
    category: 'cash_flow',
    description: 'Months to payoff and total interest for a fixed-payment loan.',
    usesAssumptions: false,
    inputs: ['balance', 'annualRate', 'monthlyPayment'],
  },
]

/** Look up formula metadata by id. */
export function formulaMeta(id: string): FormulaMeta | undefined {
  return FORMULAS.find((f) => f.id === id)
}
