// src/lib/fna/calculate.ts
// The plan CALCULATION ORCHESTRATOR (ADR-015/016). Maps a plan's structured inputs
// to the deterministic engine formulas configured for its plan type, and returns
// per-formula result envelopes + completeness. PURE — the engine is pure and this
// holds no I/O, so it unit-tests offline (tests/fna-calculate.test.mjs). The AI is
// never involved here; no figure originates from a model (build instruction §0).

import {
  cashFlow,
  netWorth,
  emergencyFund,
  lifeInsuranceNeed,
  coverageGap,
  disabilityExposure,
  retirementProjection,
  educationFunding,
  survivorIncome,
  type AssumptionSet,
  type CalcContext,
  type CalcResult,
} from './engine'
import { planTypeDef, planFieldKeys } from './plan-types'

/** Flat, normalized input map keyed by field key (see plan-types fields). */
export type PlanValues = Record<string, number>

/** Normalize fna_inputs rows into a flat numeric map (last numeric value wins). */
export function normalizeInputs(
  rows: Array<{ key: string; value_numeric?: number | null }>,
): PlanValues {
  const out: PlanValues = {}
  for (const r of rows) {
    if (typeof r.value_numeric === 'number' && Number.isFinite(r.value_numeric)) {
      out[r.key] = r.value_numeric
    }
  }
  return out
}

export interface PlanResultEntry {
  formula_id: string
  formula_version: string
  envelope: CalcResult<unknown>
  confidence: 'high' | 'medium' | 'low'
}

export interface PlanCalculation {
  planTypeId: string
  results: PlanResultEntry[]
  /** 0..1 fraction of the plan type's fields that were supplied. */
  completeness: number
  /** Field keys the plan type expects that were not supplied. */
  missingFields: string[]
}

function has(v: PlanValues, k: string): boolean {
  return typeof v[k] === 'number'
}

/**
 * Run every analysis configured for the plan type over the supplied values.
 * Absent inputs are simply not passed — the engine degrades to a warning + lowered
 * confidence rather than throwing (build instruction §0.B). Never blocks.
 */
export function calculatePlan(
  planTypeId: string,
  values: PlanValues,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): PlanCalculation {
  const def = planTypeDef(planTypeId)
  const analyses = def?.analyses ?? []
  const results: PlanResultEntry[] = []

  const push = (r: CalcResult<unknown>) =>
    results.push({ formula_id: r.formula_id, formula_version: r.formula_version, envelope: r, confidence: r.confidence })

  // A life-insurance income-replacement gross need feeds the coverage-gap "need".
  let lifeIncomeReplacementGross = 0

  for (const id of analyses) {
    switch (id) {
      case 'cash_flow':
        push(cashFlow({ monthlyIncome: values.monthly_income ?? 0, monthlyExpenses: has(values, 'monthly_expenses') ? values.monthly_expenses : undefined }, ctx))
        break
      case 'net_worth':
        push(
          netWorth(
            {
              assets: has(values, 'total_assets') ? [{ label: 'Total assets', amount: values.total_assets }] : [],
              liabilities: has(values, 'total_liabilities') ? [{ label: 'Total liabilities', amount: values.total_liabilities }] : [],
            },
            ctx,
          ),
        )
        break
      case 'emergency_fund':
        push(
          emergencyFund(
            {
              liquidAssets: values.liquid_assets ?? 0,
              monthlyEssentialExpenses: values.monthly_essential_expenses ?? values.monthly_expenses ?? 0,
            },
            assumptions,
            ctx,
          ),
        )
        break
      case 'life_insurance_need': {
        const r = lifeInsuranceNeed(
          {
            annualIncome: (values.monthly_income ?? 0) * 12,
            existingCoverage: has(values, 'existing_life_coverage') ? values.existing_life_coverage : undefined,
            totalDebts: values.total_debt ?? values.total_liabilities ?? 0,
          },
          assumptions,
          ctx,
        )
        const out = r.output as { incomeReplacement: { grossNeed: number } }
        lifeIncomeReplacementGross = out.incomeReplacement.grossNeed
        push(r)
        break
      }
      case 'coverage_gap':
        push(
          coverageGap(
            {
              coverage: has(values, 'existing_life_coverage')
                ? [{ label: 'In-force life', type: 'life', faceAmount: values.existing_life_coverage }]
                : [],
              recommendedNeed: lifeIncomeReplacementGross,
            },
            ctx,
          ),
        )
        break
      case 'disability_exposure':
        push(
          disabilityExposure(
            {
              monthlyIncome: values.monthly_income ?? 0,
              existingMonthlyBenefit: has(values, 'existing_disability_monthly') ? values.existing_disability_monthly : undefined,
            },
            assumptions,
            ctx,
          ),
        )
        break
      case 'retirement_projection':
        if (has(values, 'current_age') && has(values, 'desired_annual_income')) {
          push(
            retirementProjection(
              {
                currentAge: values.current_age,
                currentSavings: has(values, 'current_retirement_savings') ? values.current_retirement_savings : undefined,
                annualContribution: values.annual_retirement_contribution ?? 0,
                desiredAnnualIncome: values.desired_annual_income,
                otherAnnualIncome: has(values, 'other_annual_income') ? values.other_annual_income : undefined,
              },
              assumptions,
              ctx,
            ),
          )
        }
        break
      case 'education_funding':
        if (has(values, 'years_until_college') && has(values, 'annual_college_cost_today')) {
          push(
            educationFunding(
              {
                yearsUntilCollege: values.years_until_college,
                annualCostToday: values.annual_college_cost_today,
                currentSavings: has(values, 'education_current_savings') ? values.education_current_savings : undefined,
              },
              assumptions,
              ctx,
            ),
          )
        }
        break
      case 'survivor_income':
        if (has(values, 'survivor_annual_need') && has(values, 'survivor_years_needed')) {
          push(
            survivorIncome(
              {
                survivorAnnualNeed: values.survivor_annual_need,
                yearsNeeded: values.survivor_years_needed,
                existingResources: has(values, 'existing_life_coverage') ? values.existing_life_coverage : undefined,
              },
              assumptions,
              ctx,
            ),
          )
        }
        break
      default:
        break
    }
  }

  const expected = planFieldKeys(planTypeId)
  const missingFields = expected.filter((k) => !has(values, k))
  const completeness = expected.length === 0 ? 1 : (expected.length - missingFields.length) / expected.length

  return { planTypeId, results, completeness, missingFields }
}
