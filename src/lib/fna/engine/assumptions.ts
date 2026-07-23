// src/lib/fna/engine/assumptions.ts
// First-class, VERSIONED, LABELED planning assumptions (ADR-015 §6, CLAUDE.md §4.3).
// These are CONFIG DEFAULTS TO VERIFY — never Farmers/FFS-published facts. Every
// value ships is_assumption: true so the UI renders the gold "config default —
// verify" badge. A calculation records the exact assumption-set VERSION it used,
// so any result can be recomputed identically.
//
// This module holds no I/O. The persisted, editable assumption store arrives in
// slice 2; the engine consumes whatever set it is handed. DEFAULT_ASSUMPTIONS is
// the seed the service layer clones and lets the FSA edit.

import { type AssumptionRef } from './types'

/** Canonical assumption keys the formulas may reference. */
export type AssumptionKey =
  | 'inflation_rate'
  | 'wage_growth_rate'
  | 'investment_return_pre_retirement'
  | 'investment_return_post_retirement'
  | 'retirement_age'
  | 'life_expectancy'
  | 'education_inflation_rate'
  | 'social_security_cola'
  | 'effective_tax_rate'
  | 'safe_withdrawal_rate'
  | 'emergency_fund_months'
  | 'disability_replacement_pct'
  | 'income_replacement_years'
  | 'final_expenses'

export interface Assumption {
  key: AssumptionKey
  value: number
  /** e.g. 'rate' (decimal fraction), 'pct' (0-100), 'years', 'months', 'usd'. */
  unit: 'rate' | 'pct' | 'years' | 'months' | 'usd'
  /** Where the default came from — always a labeled default, never a fact. */
  source: string
  /** ISO date the value became effective. */
  effective_date: string
  is_assumption: true
}

export interface AssumptionSet {
  version: string
  label: string
  assumptions: Assumption[]
}

/**
 * Seed assumption-set v1. Values are conventional planning defaults, explicitly
 * labeled as assumptions to verify — NOT Farmers/FFS figures (CLAUDE.md §4.3).
 * effective_date is a fixed constant (no ambient clock — determinism).
 */
export const DEFAULT_ASSUMPTIONS: AssumptionSet = {
  version: 'default-v1',
  label: 'FSOS planning defaults (config — verify before relying on them)',
  assumptions: [
    { key: 'inflation_rate', value: 0.03, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'wage_growth_rate', value: 0.03, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'investment_return_pre_retirement', value: 0.06, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'investment_return_post_retirement', value: 0.04, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'retirement_age', value: 67, unit: 'years', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'life_expectancy', value: 92, unit: 'years', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'education_inflation_rate', value: 0.05, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'social_security_cola', value: 0.02, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'effective_tax_rate', value: 0.22, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'safe_withdrawal_rate', value: 0.04, unit: 'rate', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'emergency_fund_months', value: 6, unit: 'months', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'disability_replacement_pct', value: 60, unit: 'pct', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'income_replacement_years', value: 10, unit: 'years', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
    { key: 'final_expenses', value: 15000, unit: 'usd', source: 'config default', effective_date: '2026-01-01', is_assumption: true },
  ],
}

/** Look up one assumption in a set. Throws if absent — a formula must not guess. */
export function getAssumption(set: AssumptionSet, key: AssumptionKey): Assumption {
  const a = set.assumptions.find((x) => x.key === key)
  if (!a) throw new Error(`assumption not found in set ${set.version}: ${key}`)
  return a
}

/** The numeric value of one assumption. */
export function assumptionValue(set: AssumptionSet, key: AssumptionKey): number {
  return getAssumption(set, key).value
}

/** Build an AssumptionRef for the result envelope, pinning the set version. */
export function assumptionRef(set: AssumptionSet, key: AssumptionKey): AssumptionRef {
  const a = getAssumption(set, key)
  return {
    key: a.key,
    value: a.value,
    unit: a.unit,
    assumption_set_version: set.version,
    is_assumption: true,
  }
}
