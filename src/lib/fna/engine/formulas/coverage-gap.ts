// src/lib/fna/engine/formulas/coverage-gap.ts
// Existing-coverage inventory and gap: sum in-force coverage (optionally by type)
// and compare it to a recommended need → gap or surplus. Pure decimal.js
// (ADR-015). ANALYSIS only — no product or replacement recommendation (§1).

import { D, atLeastZero, money, rate, ratio, str, sum, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const COVERAGE_GAP_ID = 'coverage_gap'
export const COVERAGE_GAP_VERSION = '1.0.0'

export interface CoverageLine {
  label: string
  /** Coverage category, e.g. 'life', 'disability', 'ltc'. Free-text. */
  type?: string
  faceAmount: number
}

export interface CoverageGapInput {
  coverage: CoverageLine[]
  /** The recommended coverage need this inventory is measured against. */
  recommendedNeed: number
}

export interface CoverageGapOutput {
  totalCoverage: number
  recommendedNeed: number
  /** max(0, need − coverage). 0 when adequately covered. */
  gap: number
  /** max(0, coverage − need). 0 when under-covered. */
  surplus: number
  coverageRatio: number
  byType: Record<string, number>
  isAdequate: boolean
}

export function coverageGap(input: CoverageGapInput, ctx: CalcContext): CalcResult<CoverageGapOutput> {
  const total = sum(input.coverage.map((c) => c.faceAmount))
  const need = D(input.recommendedNeed)
  const gap = atLeastZero(need.minus(total))
  const surplus = atLeastZero(total.minus(need))

  const byType: Record<string, number> = {}
  for (const c of input.coverage) {
    const key = c.type ?? 'unclassified'
    byType[key] = money(D(byType[key] ?? 0).plus(c.faceAmount))
  }

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (input.coverage.length === 0) {
    warnings.push({ code: 'no_coverage', message: 'No in-force coverage supplied; the full need reads as a gap.', severity: 'warning' })
  }

  return buildResult<CoverageGapOutput>({
    formulaId: COVERAGE_GAP_ID,
    formulaVersion: COVERAGE_GAP_VERSION,
    inputs: { coverageLines: input.coverage.length, recommendedNeed: input.recommendedNeed },
    output: {
      totalCoverage: money(total),
      recommendedNeed: money(need),
      gap: money(gap),
      surplus: money(surplus),
      coverageRatio: rate(ratio(total, need)),
      byType,
      isAdequate: total.greaterThanOrEqualTo(need),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { totalCoverageExact: str(total), gapExact: str(gap) },
    warnings,
    missingInputs: missing,
  })
}
