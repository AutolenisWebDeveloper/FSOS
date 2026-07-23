// src/lib/fna/engine/formulas/education.ts
// Education funding need and shortfall for one goal (e.g. a child). Inflates the
// annual cost by an education-inflation ASSUMPTION across the college years,
// discounts the cost stream to a capital target at matriculation, and compares to
// projected savings. Pure decimal.js (ADR-015). ANALYSIS only (§1).

import { D, Decimal, atLeastZero, money, rate, ratio, str, MONEY_ROUNDING } from '../money'
import { futureValueDecimal } from './future-value'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const EDUCATION_ID = 'education_funding'
export const EDUCATION_VERSION = '1.0.0'

export interface EducationInput {
  /** Years until the first year of college. */
  yearsUntilCollege: number
  /** Number of college years to fund. Default 4. */
  yearsOfCollege?: number
  /** Annual cost of the target school in TODAY's dollars. */
  annualCostToday: number
  /** Education savings earmarked today. Default 0. */
  currentSavings?: number
  /** Annual contribution to education savings until matriculation. Default 0. */
  annualContribution?: number
}

export interface EducationOutput {
  yearsUntilCollege: number
  yearsOfCollege: number
  /** Nominal sum of inflated annual costs across the college years. */
  totalProjectedCost: number
  /** Capital needed at matriculation to fund the discounted cost stream. */
  capitalNeededAtStart: number
  projectedSavingsAtStart: number
  /** max(0, capitalNeeded − projectedSavings). */
  shortfall: number
  surplus: number
  fundedRatio: number
}

export function educationFunding(
  input: EducationInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<EducationOutput> {
  const years = Math.max(0, Math.floor(input.yearsUntilCollege))
  const collegeYears = Math.max(1, Math.floor(input.yearsOfCollege ?? 4))
  const eduInflation = assumptionValue(assumptions, 'education_inflation_rate')
  const growth = assumptionValue(assumptions, 'investment_return_pre_retirement')

  const costToday = D(input.annualCostToday)
  let totalNominal = new Decimal(0)
  let capitalAtStart = new Decimal(0)
  for (let k = 0; k < collegeYears; k++) {
    // Cost of college year k occurs at time (years + k), inflated from today.
    const costK = costToday.times(D(1 + eduInflation).pow(years + k))
    totalNominal = totalNominal.plus(costK)
    // Discount back to matriculation (time = years) at the savings growth rate.
    capitalAtStart = capitalAtStart.plus(costK.dividedBy(D(1 + growth).pow(k)))
  }

  const projected = futureValueDecimal({
    presentValue: input.currentSavings ?? 0,
    ratePerPeriod: growth,
    periods: years,
    payment: input.annualContribution ?? 0,
  })
  const shortfall = atLeastZero(capitalAtStart.minus(projected))
  const surplus = atLeastZero(projected.minus(capitalAtStart))

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.currentSavings == null) {
    missing.push('currentSavings')
    warnings.push({ code: 'savings_unknown', message: 'Education savings not supplied; projection assumes $0.', severity: 'warning' })
  }

  return buildResult<EducationOutput>({
    formulaId: EDUCATION_ID,
    formulaVersion: EDUCATION_VERSION,
    inputs: {
      yearsUntilCollege: years,
      yearsOfCollege: collegeYears,
      annualCostToday: input.annualCostToday,
      currentSavings: input.currentSavings ?? 0,
      annualContribution: input.annualContribution ?? 0,
    },
    output: {
      yearsUntilCollege: years,
      yearsOfCollege: collegeYears,
      totalProjectedCost: money(totalNominal),
      capitalNeededAtStart: money(capitalAtStart),
      projectedSavingsAtStart: money(projected),
      shortfall: money(shortfall),
      surplus: money(surplus),
      fundedRatio: rate(ratio(projected, capitalAtStart)),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed: [
      assumptionRef(assumptions, 'education_inflation_rate'),
      assumptionRef(assumptions, 'investment_return_pre_retirement'),
    ],
    intermediates: { totalNominalExact: str(totalNominal), capitalAtStartExact: str(capitalAtStart), projectedExact: str(projected) },
    warnings,
    missingInputs: missing,
  })
}
