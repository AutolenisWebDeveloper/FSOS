// src/lib/fna/engine/formulas/cash-flow.ts
// Cash-flow analysis: monthly income vs. expenses → surplus/deficit + savings
// rate, with annualized figures. Pure decimal.js (ADR-015). Missing expenses do
// not block — they degrade confidence and are surfaced as a warning (§0.B).

import { D, money, ratio, rate, str, sum, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const CASH_FLOW_ID = 'cash_flow'
export const CASH_FLOW_VERSION = '1.0.0'

export interface CashFlowInput {
  /** Total monthly income (all sources, gross or net — caller decides & labels). */
  monthlyIncome: number
  /** Total monthly expenses. Optional — absence lowers confidence, never blocks. */
  monthlyExpenses?: number
}

export interface CashFlowOutput {
  monthlyIncome: number
  monthlyExpenses: number
  /** monthlyIncome − monthlyExpenses (positive = surplus, negative = deficit). */
  monthlySurplus: number
  annualSurplus: number
  /** surplus / income, as a 0–1 ratio (0 when income is 0). */
  savingsRate: number
  isDeficit: boolean
}

export function cashFlow(input: CashFlowInput, ctx: CalcContext): CalcResult<CashFlowOutput> {
  const income = D(input.monthlyIncome)
  const hasExpenses = typeof input.monthlyExpenses === 'number'
  const expenses = D(input.monthlyExpenses ?? 0)

  const surplus = income.minus(expenses)
  const annual = surplus.times(12)
  const savings = ratio(surplus, income)

  const warnings: CalcWarning[] = []
  const missing: string[] = []
  if (!hasExpenses) {
    missing.push('monthlyExpenses')
    warnings.push({
      code: 'missing_expenses',
      message: 'Monthly expenses not supplied; surplus assumes $0 expenses and is an upper bound.',
      severity: 'warning',
    })
  }

  return buildResult<CashFlowOutput>({
    formulaId: CASH_FLOW_ID,
    formulaVersion: CASH_FLOW_VERSION,
    inputs: { monthlyIncome: input.monthlyIncome, monthlyExpenses: input.monthlyExpenses ?? 0 },
    output: {
      monthlyIncome: money(income),
      monthlyExpenses: money(expenses),
      monthlySurplus: money(surplus),
      annualSurplus: money(annual),
      savingsRate: rate(savings),
      isDeficit: surplus.isNegative(),
    },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { surplusExact: str(surplus), savingsRateExact: str(savings), totalIncome: str(sum([income])) },
    warnings,
    missingInputs: missing,
  })
}
