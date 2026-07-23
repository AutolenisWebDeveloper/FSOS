// src/lib/fna/engine/formulas/retirement.ts
// Retirement income projection and shortfall/surplus. Projects current savings +
// contributions to the retirement date, inflates the income goal, discounts the
// retirement-years income need to a capital target at a real post-retirement rate,
// and compares. Pure decimal.js (ADR-015). ANALYSIS only (§1) — Social Security /
// pension are LABELED assumptions the caller passes in, never estimated as fact.

import { D, atLeastZero, money, rate, ratio, str, MONEY_ROUNDING } from '../money'
import { futureValueDecimal } from './future-value'
import { annuityPresentValueDecimal } from './present-value'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const RETIREMENT_ID = 'retirement_projection'
export const RETIREMENT_VERSION = '1.0.0'

export interface RetirementInput {
  currentAge: number
  /** Retirement age; overrides the assumption default. */
  retirementAgeOverride?: number
  /** Life expectancy; overrides the assumption default. */
  lifeExpectancyOverride?: number
  /** Retirement assets today. Default 0. */
  currentSavings?: number
  /** Annual contribution toward retirement, level to retirement. Default 0. */
  annualContribution?: number
  /** Desired annual retirement income in TODAY's dollars. */
  desiredAnnualIncome: number
  /** Other annual income at retirement in today's dollars (SS, pension). Default 0. */
  otherAnnualIncome?: number
}

export interface RetirementOutput {
  yearsToRetirement: number
  yearsInRetirement: number
  projectedSavingsAtRetirement: number
  desiredIncomeAtRetirement: number
  netAnnualIncomeNeed: number
  capitalNeededAtRetirement: number
  /** max(0, capitalNeeded − projectedSavings). */
  shortfall: number
  /** max(0, projectedSavings − capitalNeeded). */
  surplus: number
  fundedRatio: number
  /** Sustainable annual income the projected savings can fund over retirement. */
  sustainableAnnualIncome: number
  /** (sustainable − need)/12: positive = monthly cushion, negative = monthly gap. */
  monthlyIncomeMargin: number
  onTrack: boolean
}

export function retirementProjection(
  input: RetirementInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<RetirementOutput> {
  const retirementAge =
    typeof input.retirementAgeOverride === 'number' ? input.retirementAgeOverride : assumptionValue(assumptions, 'retirement_age')
  const lifeExpectancy =
    typeof input.lifeExpectancyOverride === 'number' ? input.lifeExpectancyOverride : assumptionValue(assumptions, 'life_expectancy')
  const preReturn = assumptionValue(assumptions, 'investment_return_pre_retirement')
  const postReturn = assumptionValue(assumptions, 'investment_return_post_retirement')
  const inflation = assumptionValue(assumptions, 'inflation_rate')

  const yearsToRetirement = Math.max(0, Math.floor(retirementAge - input.currentAge))
  const yearsInRetirement = Math.max(0, Math.floor(lifeExpectancy - retirementAge))

  // Project savings to the retirement date.
  const projected = futureValueDecimal({
    presentValue: input.currentSavings ?? 0,
    ratePerPeriod: preReturn,
    periods: yearsToRetirement,
    payment: input.annualContribution ?? 0,
  })

  // Inflate the income goal and other income to the retirement year.
  const inflator = D(1 + inflation).pow(yearsToRetirement)
  const desiredAtRet = D(input.desiredAnnualIncome).times(inflator)
  const otherAtRet = D(input.otherAnnualIncome ?? 0).times(inflator)
  const netNeed = atLeastZero(desiredAtRet.minus(otherAtRet))

  // Capital needed at retirement = PV of the net income need over retirement years
  // at the real post-retirement rate (Fisher).
  const realPost = D(1 + postReturn).dividedBy(1 + inflation).minus(1)
  const capitalNeeded = annuityPresentValueDecimal(netNeed.toNumber(), realPost.toNumber(), yearsInRetirement)

  const shortfall = atLeastZero(capitalNeeded.minus(projected))
  const surplus = atLeastZero(projected.minus(capitalNeeded))

  // Sustainable annual income the projected savings can fund over retirement.
  const annuityFactor = annuityPresentValueDecimal(1, realPost.toNumber(), yearsInRetirement)
  const sustainable = annuityFactor.isZero() ? D(0) : projected.dividedBy(annuityFactor)
  const monthlyMargin = sustainable.minus(netNeed).dividedBy(12)

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.currentAge >= retirementAge) {
    warnings.push({
      code: 'at_or_past_retirement',
      message: 'Current age is at or past the retirement age; projection horizon is zero years.',
      severity: 'warning',
    })
  }
  if (input.currentSavings == null) {
    missing.push('currentSavings')
    warnings.push({ code: 'savings_unknown', message: 'Current retirement savings not supplied; projection assumes $0.', severity: 'warning' })
  }
  if (input.otherAnnualIncome == null) {
    missing.push('otherAnnualIncome')
    warnings.push({
      code: 'other_income_unknown',
      message: 'Social Security / pension not supplied; the full income goal is drawn from personal savings.',
      severity: 'warning',
    })
  }

  return buildResult<RetirementOutput>({
    formulaId: RETIREMENT_ID,
    formulaVersion: RETIREMENT_VERSION,
    inputs: {
      currentAge: input.currentAge,
      retirementAge,
      lifeExpectancy,
      currentSavings: input.currentSavings ?? 0,
      annualContribution: input.annualContribution ?? 0,
      desiredAnnualIncome: input.desiredAnnualIncome,
      otherAnnualIncome: input.otherAnnualIncome ?? 0,
    },
    output: {
      yearsToRetirement,
      yearsInRetirement,
      projectedSavingsAtRetirement: money(projected),
      desiredIncomeAtRetirement: money(desiredAtRet),
      netAnnualIncomeNeed: money(netNeed),
      capitalNeededAtRetirement: money(capitalNeeded),
      shortfall: money(shortfall),
      surplus: money(surplus),
      fundedRatio: rate(ratio(projected, capitalNeeded)),
      sustainableAnnualIncome: money(sustainable),
      monthlyIncomeMargin: money(monthlyMargin),
      onTrack: projected.greaterThanOrEqualTo(capitalNeeded),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed: [
      ...(typeof input.retirementAgeOverride === 'number' ? [] : [assumptionRef(assumptions, 'retirement_age')]),
      ...(typeof input.lifeExpectancyOverride === 'number' ? [] : [assumptionRef(assumptions, 'life_expectancy')]),
      assumptionRef(assumptions, 'investment_return_pre_retirement'),
      assumptionRef(assumptions, 'investment_return_post_retirement'),
      assumptionRef(assumptions, 'inflation_rate'),
    ],
    intermediates: {
      projectedSavingsExact: str(projected),
      netNeedExact: str(netNeed),
      capitalNeededExact: str(capitalNeeded),
      realPostRate: str(realPost),
    },
    warnings,
    missingInputs: missing,
  })
}
