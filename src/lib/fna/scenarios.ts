// src/lib/fna/scenarios.ts
// PURE scenario engine (build instruction §4/§6, ADR-015/016). A scenario is a
// named what-if BRANCHED FROM A FROZEN VERSION: it applies overrides to that
// version's inputs and/or assumptions, then RE-RUNS the same deterministic
// orchestrator. No I/O, no clock (caller passes computedAt); unit-tested offline.
// Scenarios never mutate the base version — they store their own overrides +
// results (fna_scenarios) pinned to base_version_id.

import { calculatePlan, type PlanValues, type PlanCalculation } from './calculate'
import type { AssumptionSet, CalcContext } from './engine'

export interface ScenarioOverride {
  /** Replace input values outright. */
  inputs?: Record<string, number>
  /** Add to existing input values (floored at 0). */
  inputDeltas?: Record<string, number>
  /** Override assumption values by key. */
  assumptions?: Record<string, number>
}

export interface ScenarioPreset {
  type: string
  name: string
  description: string
  override: ScenarioOverride
}

// Retirement-focused presets ship first (Slice 5); more are config entries.
export const SCENARIO_PRESETS: ScenarioPreset[] = [
  { type: 'retirement_age_62', name: 'Retire at 62', description: 'Earlier retirement — shorter accumulation, longer drawdown.', override: { assumptions: { retirement_age: 62 } } },
  { type: 'retirement_age_65', name: 'Retire at 65', description: 'Retire at 65.', override: { assumptions: { retirement_age: 65 } } },
  { type: 'retirement_age_70', name: 'Retire at 70', description: 'Later retirement — more accumulation, shorter drawdown.', override: { assumptions: { retirement_age: 70 } } },
  { type: 'increased_savings', name: 'Save $6k more / yr', description: 'Increase annual retirement contribution by $6,000.', override: { inputDeltas: { annual_retirement_contribution: 6000 } } },
  { type: 'reduced_expenses', name: 'Cut expenses $500 / mo', description: 'Reduce monthly expenses by $500.', override: { inputDeltas: { monthly_expenses: -500, monthly_essential_expenses: -500 } } },
  { type: 'high_inflation', name: 'High inflation (5%)', description: 'Stress the plan with 5% inflation.', override: { assumptions: { inflation_rate: 0.05 } } },
  { type: 'low_inflation', name: 'Low inflation (2%)', description: 'Model 2% inflation.', override: { assumptions: { inflation_rate: 0.02 } } },
  { type: 'market_stress', name: 'Market stress', description: 'Lower returns: 3% pre / 2% post retirement.', override: { assumptions: { investment_return_pre_retirement: 0.03, investment_return_post_retirement: 0.02 } } },
  { type: 'long_life', name: 'Long life (to 100)', description: 'Longevity sensitivity — plan to age 100.', override: { assumptions: { life_expectancy: 100 } } },
  { type: 'delayed_social_security', name: 'Delay Social Security', description: 'Higher other retirement income from delaying Social Security.', override: { inputDeltas: { other_annual_income: 8000 } } },
  { type: 'education_fund_more', name: 'Fund education +$3k / yr', description: 'Increase annual education contribution by $3,000.', override: { inputDeltas: { education_annual_contribution: 3000 } } },
  { type: 'lower_cost_school', name: 'Lower-cost school', description: 'Model a school $10,000/yr less expensive.', override: { inputDeltas: { annual_college_cost_today: -10000 } } },
  { type: 'delay_college', name: 'Delay college 2 years', description: 'Two more years to save before college.', override: { inputDeltas: { years_until_college: 2 } } },
]

export function scenarioPreset(type: string): ScenarioPreset | undefined {
  return SCENARIO_PRESETS.find((p) => p.type === type)
}

/** Apply an override to base values + assumptions, returning fresh copies. */
export function applyOverride(
  baseValues: PlanValues,
  baseAssumptions: AssumptionSet,
  override: ScenarioOverride,
): { values: PlanValues; assumptions: AssumptionSet } {
  const values: PlanValues = { ...baseValues }
  if (override.inputs) for (const [k, v] of Object.entries(override.inputs)) values[k] = v
  if (override.inputDeltas) for (const [k, d] of Object.entries(override.inputDeltas)) values[k] = Math.max(0, (values[k] ?? 0) + d)

  const overridden = override.assumptions ?? {}
  const assumptions: AssumptionSet = {
    version: Object.keys(overridden).length > 0 ? `${baseAssumptions.version}+scenario` : baseAssumptions.version,
    label: baseAssumptions.label,
    assumptions: baseAssumptions.assumptions.map((a) => (a.key in overridden ? { ...a, value: overridden[a.key] } : a)),
  }
  return { values, assumptions }
}

/** Compute a scenario: apply the override then re-run the orchestrator. Pure. */
export function computeScenario(
  planTypeId: string,
  baseValues: PlanValues,
  baseAssumptions: AssumptionSet,
  override: ScenarioOverride,
  ctx: CalcContext,
): PlanCalculation {
  const { values, assumptions } = applyOverride(baseValues, baseAssumptions, override)
  return calculatePlan(planTypeId, values, assumptions, ctx)
}
