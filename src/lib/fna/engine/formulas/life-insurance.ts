// src/lib/fna/engine/formulas/life-insurance.ts
// Life-insurance NEED by two methods, BOTH LABELED (build instruction §3):
//   • income-replacement — PV of the insured's income stream over a replacement
//     horizon at a real (inflation-adjusted) rate;
//   • capital-needs — immediate obligations + income-replacement capital, less
//     existing liquid resources and in-force coverage.
// Pure decimal.js (ADR-015). This is ANALYSIS (a need + a gap), NOT a product or
// suitability recommendation — that is authored by the licensed FSA (§1).

import { D, atLeastZero, money, rate, str, MONEY_ROUNDING } from '../money'
import { annuityPresentValueDecimal } from './present-value'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const LIFE_INSURANCE_ID = 'life_insurance_need'
export const LIFE_INSURANCE_VERSION = '1.0.0'

export interface LifeInsuranceInput {
  /** Annual income to be replaced on the insured's death. */
  annualIncome: number
  /** In-force life coverage on the insured (all policies). Default 0. */
  existingCoverage?: number
  /** Years of income to replace; overrides the assumption default. */
  yearsToReplaceOverride?: number
  /** Outstanding debts to retire at death (mortgage, loans). Default 0. */
  totalDebts?: number
  /** Education funding goal to pre-fund at death. Default 0. */
  educationFundNeed?: number
  /** Emergency reserve to leave survivors. Default 0. */
  emergencyFundNeed?: number
  /** Final-expenses override (else assumption). */
  finalExpensesOverride?: number
  /** Liquid assets survivors could apply against the need (capital-needs method). */
  liquidAssetsAvailable?: number
}

export interface LifeMethodResult {
  method: 'income_replacement' | 'capital_needs'
  /** The gross need this method computes before existing coverage is applied. */
  grossNeed: number
  /** Additional coverage indicated after resources/coverage applied. */
  additionalNeed: number
}

export interface LifeInsuranceOutput {
  existingCoverage: number
  incomeReplacement: LifeMethodResult
  capitalNeeds: LifeMethodResult
  /** Real (inflation-adjusted) discount rate used, as a 0–1 ratio. */
  realRate: number
}

export function lifeInsuranceNeed(
  input: LifeInsuranceInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<LifeInsuranceOutput> {
  const existing = D(input.existingCoverage ?? 0)
  const years =
    typeof input.yearsToReplaceOverride === 'number'
      ? input.yearsToReplaceOverride
      : assumptionValue(assumptions, 'income_replacement_years')
  const finalExpenses =
    typeof input.finalExpensesOverride === 'number'
      ? input.finalExpensesOverride
      : assumptionValue(assumptions, 'final_expenses')

  const invReturn = assumptionValue(assumptions, 'investment_return_pre_retirement')
  const inflation = assumptionValue(assumptions, 'inflation_rate')
  // Fisher real rate: (1+r)/(1+i) − 1.
  const realRate = D(1 + invReturn).dividedBy(1 + inflation).minus(1)

  // Income-replacement: PV of the annual income stream over the horizon.
  const incomeCapital = annuityPresentValueDecimal(input.annualIncome, realRate.toNumber(), years)
  const incomeReplacementAdditional = atLeastZero(incomeCapital.minus(existing))

  // Capital-needs: immediate obligations + income-replacement capital, less
  // liquid resources and in-force coverage.
  const debts = D(input.totalDebts ?? 0)
  const education = D(input.educationFundNeed ?? 0)
  const emergency = D(input.emergencyFundNeed ?? 0)
  const liquid = D(input.liquidAssetsAvailable ?? 0)
  const capitalGross = D(finalExpenses).plus(debts).plus(education).plus(emergency).plus(incomeCapital)
  const capitalAdditional = atLeastZero(capitalGross.minus(liquid).minus(existing))

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.existingCoverage == null) {
    missing.push('existingCoverage')
    warnings.push({
      code: 'existing_coverage_unknown',
      message: 'In-force coverage not supplied; additional-need figures assume $0 existing coverage.',
      severity: 'warning',
    })
  }

  return buildResult<LifeInsuranceOutput>({
    formulaId: LIFE_INSURANCE_ID,
    formulaVersion: LIFE_INSURANCE_VERSION,
    inputs: {
      annualIncome: input.annualIncome,
      existingCoverage: input.existingCoverage ?? 0,
      yearsToReplace: years,
      totalDebts: input.totalDebts ?? 0,
      educationFundNeed: input.educationFundNeed ?? 0,
      emergencyFundNeed: input.emergencyFundNeed ?? 0,
      finalExpenses,
      liquidAssetsAvailable: input.liquidAssetsAvailable ?? 0,
    },
    output: {
      existingCoverage: money(existing),
      incomeReplacement: {
        method: 'income_replacement',
        grossNeed: money(incomeCapital),
        additionalNeed: money(incomeReplacementAdditional),
      },
      capitalNeeds: {
        method: 'capital_needs',
        grossNeed: money(capitalGross),
        additionalNeed: money(capitalAdditional),
      },
      realRate: rate(realRate),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed: [
      assumptionRef(assumptions, 'investment_return_pre_retirement'),
      assumptionRef(assumptions, 'inflation_rate'),
      ...(typeof input.yearsToReplaceOverride === 'number' ? [] : [assumptionRef(assumptions, 'income_replacement_years')]),
      ...(typeof input.finalExpensesOverride === 'number' ? [] : [assumptionRef(assumptions, 'final_expenses')]),
    ],
    intermediates: {
      realRateExact: str(realRate),
      incomeReplacementCapital: str(incomeCapital),
      capitalNeedsGross: str(capitalGross),
    },
    warnings,
    missingInputs: missing,
  })
}
