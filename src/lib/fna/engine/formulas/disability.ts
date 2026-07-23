// src/lib/fna/engine/formulas/disability.ts
// Disability income exposure: the monthly income at risk if the insured cannot
// work, vs. in-force disability benefit and a target replacement % (ASSUMPTION).
// Pure decimal.js (ADR-015). ANALYSIS only (§1).

import { D, atLeastZero, money, rate, ratio, str, MONEY_ROUNDING } from '../money'
import { assumptionRef, assumptionValue, type AssumptionSet } from '../assumptions'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const DISABILITY_ID = 'disability_exposure'
export const DISABILITY_VERSION = '1.0.0'

export interface DisabilityInput {
  /** Gross monthly earned income exposed to a disability event. */
  monthlyIncome: number
  /** In-force monthly disability benefit (employer + private). Default 0. */
  existingMonthlyBenefit?: number
  /** Override the assumption target replacement % (0–100). */
  targetReplacementPctOverride?: number
}

export interface DisabilityOutput {
  targetReplacementPct: number
  targetMonthlyBenefit: number
  existingMonthlyBenefit: number
  /** max(0, target − existing). Monthly benefit gap. */
  monthlyGap: number
  annualGap: number
  coverageRatio: number
  isAdequate: boolean
}

export function disabilityExposure(
  input: DisabilityInput,
  assumptions: AssumptionSet,
  ctx: CalcContext,
): CalcResult<DisabilityOutput> {
  const pct =
    typeof input.targetReplacementPctOverride === 'number'
      ? input.targetReplacementPctOverride
      : assumptionValue(assumptions, 'disability_replacement_pct')

  const income = D(input.monthlyIncome)
  const existing = D(input.existingMonthlyBenefit ?? 0)
  const target = income.times(pct).dividedBy(100)
  const gap = atLeastZero(target.minus(existing))

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.existingMonthlyBenefit == null) {
    missing.push('existingMonthlyBenefit')
    warnings.push({
      code: 'existing_benefit_unknown',
      message: 'In-force disability benefit not supplied; the gap assumes $0 existing benefit.',
      severity: 'warning',
    })
  }

  return buildResult<DisabilityOutput>({
    formulaId: DISABILITY_ID,
    formulaVersion: DISABILITY_VERSION,
    inputs: {
      monthlyIncome: input.monthlyIncome,
      existingMonthlyBenefit: input.existingMonthlyBenefit ?? 0,
      targetReplacementPct: pct,
    },
    output: {
      targetReplacementPct: pct,
      targetMonthlyBenefit: money(target),
      existingMonthlyBenefit: money(existing),
      monthlyGap: money(gap),
      annualGap: money(gap.times(12)),
      coverageRatio: rate(ratio(existing, target)),
      isAdequate: existing.greaterThanOrEqualTo(target),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    assumptionsUsed:
      typeof input.targetReplacementPctOverride === 'number' ? [] : [assumptionRef(assumptions, 'disability_replacement_pct')],
    intermediates: { targetExact: str(target), gapExact: str(gap) },
    warnings,
    missingInputs: missing,
  })
}
