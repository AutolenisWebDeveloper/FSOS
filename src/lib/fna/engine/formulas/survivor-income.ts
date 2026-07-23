// src/lib/fna/engine/formulas/survivor-income.ts
// Survivor income analysis: capital needed to fund a survivor's net income need
// over a horizon at a real rate, less existing resources → gap. Pure decimal.js
// (ADR-015). Household composition (surviving spouse, dependents) drives the
// inputs (slice 2); this formula computes on whatever it is handed. ANALYSIS (§1).

import { D, atLeastZero, money, rate, ratio, str, MONEY_ROUNDING } from '../money'
import { annuityPresentValueDecimal } from './present-value'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const SURVIVOR_INCOME_ID = 'survivor_income'
export const SURVIVOR_INCOME_VERSION = '1.0.0'

export interface SurvivorIncomeInput {
  /** Survivor's annual income need in today's dollars. */
  survivorAnnualNeed: number
  /** Other annual income available to the survivor (spouse income, SS survivor). Default 0. */
  survivorOtherIncome?: number
  /** Years the income need must be funded. */
  yearsNeeded: number
  /** Existing resources: in-force life proceeds + liquid assets. Default 0. */
  existingResources?: number
}

export interface SurvivorIncomeOutput {
  netAnnualNeed: number
  capitalNeeded: number
  existingResources: number
  /** max(0, capitalNeeded − existingResources). */
  gap: number
  surplus: number
  fundedRatio: number
  realRate: number
}

export function survivorIncome(
  input: SurvivorIncomeInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<SurvivorIncomeOutput> {
  const invReturn = assumptionValue(assumptions, 'investment_return_pre_retirement')
  const inflation = assumptionValue(assumptions, 'inflation_rate')
  const realRate = D(1 + invReturn).dividedBy(1 + inflation).minus(1)

  const netNeed = atLeastZero(D(input.survivorAnnualNeed).minus(input.survivorOtherIncome ?? 0))
  const years = Math.max(0, Math.floor(input.yearsNeeded))
  const capitalNeeded = annuityPresentValueDecimal(netNeed.toNumber(), realRate.toNumber(), years)
  const existing = D(input.existingResources ?? 0)
  const gap = atLeastZero(capitalNeeded.minus(existing))
  const surplus = atLeastZero(existing.minus(capitalNeeded))

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.existingResources == null) {
    missing.push('existingResources')
    warnings.push({
      code: 'resources_unknown',
      message: 'Existing survivor resources not supplied; the full capital need reads as a gap.',
      severity: 'warning',
    })
  }

  return buildResult<SurvivorIncomeOutput>({
    formulaId: SURVIVOR_INCOME_ID,
    formulaVersion: SURVIVOR_INCOME_VERSION,
    inputs: {
      survivorAnnualNeed: input.survivorAnnualNeed,
      survivorOtherIncome: input.survivorOtherIncome ?? 0,
      yearsNeeded: years,
      existingResources: input.existingResources ?? 0,
    },
    output: {
      netAnnualNeed: money(netNeed),
      capitalNeeded: money(capitalNeeded),
      existingResources: money(existing),
      gap: money(gap),
      surplus: money(surplus),
      fundedRatio: rate(ratio(existing, capitalNeeded)),
      realRate: rate(realRate),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed: [
      assumptionRef(assumptions, 'investment_return_pre_retirement'),
      assumptionRef(assumptions, 'inflation_rate'),
    ],
    intermediates: { netNeedExact: str(netNeed), capitalNeededExact: str(capitalNeeded), realRateExact: str(realRate) },
    warnings,
    missingInputs: missing,
  })
}
