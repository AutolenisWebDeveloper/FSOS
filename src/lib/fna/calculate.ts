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
  money,
  D,
  type AssumptionSet,
  type CalcContext,
  type CalcResult,
  type ValueLabel,
} from './engine'
import { planTypeDef, planFieldKeys } from './plan-types'

/** Flat, normalized input map keyed by field key (see plan-types fields). */
export type PlanValues = Record<string, number>

/** One fna_inputs row as seen by normalization (only the fields that pick a winner). */
export interface NormalizeRow {
  key: string
  value_numeric?: number | null
  source_label?: string | null
  created_at?: string | null
}

/**
 * Source authority ranking (higher wins) used to pick a deterministic value when a
 * key is supplied by more than one source. Mirrors the source labels enumerated in
 * FnaInputSchema (store.ts). A verified value (checked against a source of record)
 * outranks a client/FSA entry, which outranks a prefilled/imported value, which
 * outranks a derived/assumption value. Unknown labels rank as an estimate.
 */
// Typed by ValueLabel so adding a provenance label to the shared VALUE_LABELS tuple
// forces a rank here (compile error otherwise) — the vocabulary can't drift.
const SOURCE_RANK: Record<ValueLabel, number> = {
  verified: 7,
  client_supplied: 6,
  needs_confirmation: 5,
  imported: 4,
  estimated: 3,
  assumption_based: 2,
  calculated: 1,
  incomplete: 0,
  unavailable: 0,
}

/** Rank a source label; absent label defaults to client_supplied (schema default). */
function sourceRank(label?: string | null): number {
  if (!label) return SOURCE_RANK.client_supplied
  return SOURCE_RANK[label as ValueLabel] ?? SOURCE_RANK.estimated
}

/**
 * Normalize fna_inputs rows into a flat numeric map, picking a DETERMINISTIC winner
 * per key: highest source authority, then most recent (created_at), then larger
 * value as a final stable tie-break. This is independent of the row order the DB
 * returns, so the same stored rows always calculate to the same values, prefill
 * (imported) can never override a client entry, and repeated saves don't drift the
 * result (root-cause fix — inputs were previously "last row wins" over an unordered
 * read). Only finite numeric rows are candidates.
 */
export function normalizeInputs(rows: NormalizeRow[]): PlanValues {
  const best = new Map<string, { value: number; rank: number; at: string }>()
  for (const r of rows) {
    if (typeof r.value_numeric !== 'number' || !Number.isFinite(r.value_numeric)) continue
    const rank = sourceRank(r.source_label)
    const at = r.created_at ?? ''
    const cur = best.get(r.key)
    if (
      !cur ||
      rank > cur.rank ||
      (rank === cur.rank && at > cur.at) ||
      (rank === cur.rank && at === cur.at && r.value_numeric > cur.value)
    ) {
      best.set(r.key, { value: r.value_numeric, rank, at })
    }
  }
  const out: PlanValues = {}
  for (const [k, v] of best) out[k] = v.value
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

  // The life-insurance income-replacement gross need feeds the coverage-gap "need".
  // Compute it through a memoized helper so coverage-gap gets the correct need
  // regardless of whether life_insurance_need is listed, or listed AFTER it, in the
  // plan type's `analyses` — no dependence on a mutable loop variable set by a
  // sibling case (which previously made a reordered config silently report a $0 gap).
  let lifeResult: CalcResult<unknown> | null = null
  const computeLifeNeed = (): CalcResult<unknown> => {
    if (!lifeResult) {
      lifeResult = lifeInsuranceNeed(
        {
          annualIncome: money(D(values.monthly_income ?? 0).times(12)),
          existingCoverage: has(values, 'existing_life_coverage') ? values.existing_life_coverage : undefined,
          totalDebts: values.total_debt ?? values.total_liabilities ?? 0,
        },
        assumptions,
        ctx,
      )
    }
    return lifeResult
  }

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
      case 'life_insurance_need':
        push(computeLifeNeed())
        break
      case 'coverage_gap':
        push(
          coverageGap(
            {
              coverage: has(values, 'existing_life_coverage')
                ? [{ label: 'In-force life', type: 'life', faceAmount: values.existing_life_coverage }]
                : [],
              recommendedNeed: (computeLifeNeed().output as { incomeReplacement: { grossNeed: number } }).incomeReplacement.grossNeed,
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
                annualContribution: has(values, 'education_annual_contribution') ? values.education_annual_contribution : 0,
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
