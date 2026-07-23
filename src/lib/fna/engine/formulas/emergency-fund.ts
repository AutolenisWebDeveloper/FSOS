// src/lib/fna/engine/formulas/emergency-fund.ts
// Emergency-fund adequacy: months of essential expenses covered by liquid assets
// vs. a target buffer (target months is an ASSUMPTION). Pure decimal.js (ADR-015).

import { D, atLeastZero, money, ratio, rate, str, MONEY_ROUNDING } from '../money'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const EMERGENCY_FUND_ID = 'emergency_fund'
export const EMERGENCY_FUND_VERSION = '1.0.0'

export interface EmergencyFundInput {
  /** Liquid assets available for emergencies (cash, savings, money market). */
  liquidAssets: number
  /** Essential (non-discretionary) monthly expenses. */
  monthlyEssentialExpenses: number
  /** Override the assumption-set target months, if the FSA set a household target. */
  targetMonthsOverride?: number
}

export interface EmergencyFundOutput {
  targetMonths: number
  monthsCovered: number
  targetAmount: number
  currentAmount: number
  /** max(0, target − current). 0 when fully funded. */
  shortfall: number
  /** max(0, current − target). 0 when under-funded. */
  surplus: number
  adequacyRatio: number
  isAdequate: boolean
}

export function emergencyFund(
  input: EmergencyFundInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<EmergencyFundOutput> {
  const targetMonths =
    typeof input.targetMonthsOverride === 'number'
      ? input.targetMonthsOverride
      : assumptionValue(assumptions, 'emergency_fund_months')

  const monthly = D(input.monthlyEssentialExpenses)
  const liquid = D(input.liquidAssets)
  const targetAmount = monthly.times(targetMonths)
  const monthsCovered = ratio(liquid, monthly)
  const shortfall = atLeastZero(targetAmount.minus(liquid))
  const surplus = atLeastZero(liquid.minus(targetAmount))
  const adequacy = ratio(liquid, targetAmount)

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (monthly.isZero()) {
    missing.push('monthlyEssentialExpenses')
    warnings.push({
      code: 'no_essential_expenses',
      message: 'Essential monthly expenses are $0; months-covered and target cannot be assessed.',
      severity: 'warning',
    })
  }

  return buildResult<EmergencyFundOutput>({
    formulaId: EMERGENCY_FUND_ID,
    formulaVersion: EMERGENCY_FUND_VERSION,
    inputs: {
      liquidAssets: input.liquidAssets,
      monthlyEssentialExpenses: input.monthlyEssentialExpenses,
      targetMonths,
    },
    output: {
      targetMonths,
      monthsCovered: rate(monthsCovered),
      targetAmount: money(targetAmount),
      currentAmount: money(liquid),
      shortfall: money(shortfall),
      surplus: money(surplus),
      adequacyRatio: rate(adequacy),
      isAdequate: liquid.greaterThanOrEqualTo(targetAmount),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed:
      typeof input.targetMonthsOverride === 'number' ? [] : [assumptionRef(assumptions, 'emergency_fund_months')],
    intermediates: { targetAmountExact: str(targetAmount), monthsCoveredExact: str(monthsCovered) },
    warnings,
    missingInputs: missing,
  })
}
