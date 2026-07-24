// src/lib/fna/plan-types.ts
// PLAN-TYPE REGISTRY (build instruction §0 "one engine, many plan types"). Pure
// config — adding a plan type is a new entry here, never a new engine or data
// model. Each type declares the input FIELDS it collects (shared by the intake UI,
// the orchestrator, and completeness scoring) and the ANALYSES (engine formula
// ids) it runs. Express + Comprehensive ship first (slices 3–4); the rest are
// added as their analyses land.

export type FieldUnit = 'usd' | 'usd_monthly' | 'age' | 'years' | 'count'

export interface PlanField {
  key: string
  section: string
  label: string
  unit: FieldUnit
  help?: string
}

export interface PlanTypeDef {
  id: string
  label: string
  description: string
  /** Input sections this type collects, in intake order. */
  sections: string[]
  /** Fields collected (drives intake UI + completeness). */
  fields: PlanField[]
  /** Engine formula ids run for this type (in run order). */
  analyses: string[]
  /** Report template key (slice 7). */
  reportTemplate: string
}

// ── Shared field groups ──────────────────────────────────────────────────────
const INCOME: PlanField[] = [
  { key: 'monthly_income', section: 'income', label: 'Monthly income (gross, household)', unit: 'usd_monthly' },
]
const EXPENSES: PlanField[] = [
  { key: 'monthly_expenses', section: 'expenses', label: 'Total monthly expenses', unit: 'usd_monthly' },
  { key: 'monthly_essential_expenses', section: 'expenses', label: 'Essential monthly expenses', unit: 'usd_monthly', help: 'Non-discretionary — used for the emergency-fund target.' },
]
const BALANCE: PlanField[] = [
  { key: 'total_assets', section: 'assets', label: 'Total assets', unit: 'usd' },
  { key: 'liquid_assets', section: 'assets', label: 'Liquid assets (cash/savings)', unit: 'usd' },
  { key: 'total_liabilities', section: 'liabilities', label: 'Total liabilities', unit: 'usd' },
  { key: 'total_debt', section: 'liabilities', label: 'Debt to retire at death', unit: 'usd', help: 'Mortgage + loans, for the life-insurance need.' },
]
const COVERAGE: PlanField[] = [
  { key: 'existing_life_coverage', section: 'coverage', label: 'In-force life coverage', unit: 'usd' },
  { key: 'existing_disability_monthly', section: 'coverage', label: 'In-force disability benefit (monthly)', unit: 'usd_monthly' },
]
const RETIREMENT: PlanField[] = [
  { key: 'current_age', section: 'household', label: 'Current age (primary)', unit: 'age' },
  { key: 'desired_annual_income', section: 'retirement', label: 'Desired annual retirement income (today $)', unit: 'usd' },
  { key: 'current_retirement_savings', section: 'retirement', label: 'Current retirement savings', unit: 'usd' },
  { key: 'annual_retirement_contribution', section: 'retirement', label: 'Annual retirement contribution', unit: 'usd' },
  { key: 'other_annual_income', section: 'retirement', label: 'Other retirement income — SS/pension (today $)', unit: 'usd', help: 'Labeled assumption unless a statement is supplied.' },
]
const EDUCATION: PlanField[] = [
  { key: 'years_until_college', section: 'education', label: 'Years until college', unit: 'years' },
  { key: 'annual_college_cost_today', section: 'education', label: 'Annual college cost (today $)', unit: 'usd' },
  { key: 'education_current_savings', section: 'education', label: 'Current education savings', unit: 'usd' },
  { key: 'education_annual_contribution', section: 'education', label: 'Annual education contribution', unit: 'usd' },
]
const SURVIVOR: PlanField[] = [
  { key: 'survivor_annual_need', section: 'survivor', label: "Survivor's annual income need (today $)", unit: 'usd' },
  { key: 'survivor_years_needed', section: 'survivor', label: 'Years the survivor income is needed', unit: 'years' },
]

const EXPRESS_ANALYSES = ['cash_flow', 'net_worth', 'emergency_fund', 'life_insurance_need', 'coverage_gap', 'disability_exposure']

export const PLAN_TYPES: PlanTypeDef[] = [
  {
    id: 'express',
    label: 'Express Financial Checkup',
    description: 'The fast path — minimum inputs, immediate results. Completable in one sitting with a client.',
    sections: ['income', 'expenses', 'assets', 'liabilities', 'coverage'],
    fields: [...INCOME, ...EXPENSES, ...BALANCE, ...COVERAGE],
    analyses: EXPRESS_ANALYSES,
    reportTemplate: 'express',
  },
  {
    id: 'comprehensive',
    label: 'Comprehensive FNA',
    description: 'Full intake across cash flow, balance sheet, protection, retirement, education, and survivor needs.',
    sections: ['income', 'expenses', 'assets', 'liabilities', 'coverage', 'household', 'retirement', 'education', 'survivor'],
    fields: [...INCOME, ...EXPENSES, ...BALANCE, ...COVERAGE, ...RETIREMENT, ...EDUCATION, ...SURVIVOR],
    analyses: [...EXPRESS_ANALYSES, 'retirement_projection', 'education_funding', 'survivor_income'],
    reportTemplate: 'comprehensive',
  },
  {
    id: 'financial_plan',
    label: 'Comprehensive Financial Plan',
    description: 'The Comprehensive FNA plus scenario planning and a full client report.',
    sections: ['income', 'expenses', 'assets', 'liabilities', 'coverage', 'household', 'retirement', 'education', 'survivor'],
    fields: [...INCOME, ...EXPENSES, ...BALANCE, ...COVERAGE, ...RETIREMENT, ...EDUCATION, ...SURVIVOR],
    analyses: [...EXPRESS_ANALYSES, 'retirement_projection', 'education_funding', 'survivor_income'],
    reportTemplate: 'financial_plan',
  },
  {
    id: 'annual_review',
    label: 'Annual Review',
    description: 'A recurring refresh over the same model — attaches to a review where one applies.',
    sections: ['income', 'expenses', 'assets', 'liabilities', 'coverage'],
    fields: [...INCOME, ...EXPENSES, ...BALANCE, ...COVERAGE],
    analyses: EXPRESS_ANALYSES,
    reportTemplate: 'express',
  },
]

export function planTypeDef(id: string): PlanTypeDef | undefined {
  return PLAN_TYPES.find((p) => p.id === id)
}

export function isKnownPlanType(id: string): boolean {
  return PLAN_TYPES.some((p) => p.id === id)
}

/** All distinct field keys a plan type expects — used for completeness scoring. */
export function planFieldKeys(id: string): string[] {
  return planTypeDef(id)?.fields.map((f) => f.key) ?? []
}
