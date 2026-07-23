// src/lib/fna/engine/formulas/debt-paydown.ts
// Debt paydown: months to retire a fixed-payment loan and the total interest
// paid. Closed-form amortization in decimal.js (ADR-015). A payment that does not
// cover the periodic interest never retires the balance → WARNING, not a throw
// (§0.B). ANALYSIS only (§1).
//
//   n = −ln(1 − r·B/P) / ln(1+r)          (r > 0, requires P > r·B)
//   n = ceil(B / P)                        (r = 0)

import { D, Decimal, atLeastZero, money, str, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult, type CalcWarning } from '../types'

export const DEBT_PAYDOWN_ID = 'debt_paydown'
export const DEBT_PAYDOWN_VERSION = '1.0.0'

export interface DebtPaydownInput {
  balance: number
  /** Annual nominal interest rate as a decimal fraction (e.g. 0.06). */
  annualRate: number
  /** Fixed monthly payment. */
  monthlyPayment: number
}

export interface DebtPaydownOutput {
  balance: number
  monthlyRate: number
  /** Whole months to payoff; null when the payment never retires the balance. */
  monthsToPayoff: number | null
  totalPaid: number
  totalInterest: number
  neverPaysOff: boolean
}

export function debtPaydown(input: DebtPaydownInput, ctx: CalcContext): CalcResult<DebtPaydownOutput> {
  const balance = D(input.balance)
  const payment = D(input.monthlyPayment)
  const r = D(input.annualRate).dividedBy(12)

  const warnings: CalcWarning[] = []
  let monthsWhole: number | null = null
  let totalPaidExact = new Decimal(0)
  let interestExact = new Decimal(0)
  let neverPaysOff = false

  if (balance.lessThanOrEqualTo(0)) {
    monthsWhole = 0
  } else if (payment.lessThanOrEqualTo(0)) {
    neverPaysOff = true
    warnings.push({ code: 'no_payment', message: 'Monthly payment is $0; the balance is never retired.', severity: 'warning' })
  } else if (r.isZero()) {
    const monthsReal = balance.dividedBy(payment)
    monthsWhole = Math.ceil(monthsReal.toNumber())
    totalPaidExact = balance // no interest
    interestExact = new Decimal(0)
  } else {
    // Requires payment > periodic interest on the balance, else it never amortizes.
    const interestFirstMonth = r.times(balance)
    if (payment.lessThanOrEqualTo(interestFirstMonth)) {
      neverPaysOff = true
      warnings.push({
        code: 'payment_below_interest',
        message: 'Monthly payment does not cover the interest accruing; the balance never decreases.',
        severity: 'warning',
      })
    } else {
      // n = −ln(1 − r·B/P) / ln(1+r)
      const inner = new Decimal(1).minus(r.times(balance).dividedBy(payment))
      const monthsReal = inner.ln().negated().dividedBy(r.plus(1).ln())
      monthsWhole = Math.ceil(monthsReal.toNumber())
      // Total paid over the idealized continuous payoff; interest = paid − principal.
      totalPaidExact = payment.times(monthsReal)
      interestExact = atLeastZero(totalPaidExact.minus(balance))
    }
  }

  return buildResult<DebtPaydownOutput>({
    formulaId: DEBT_PAYDOWN_ID,
    formulaVersion: DEBT_PAYDOWN_VERSION,
    inputs: { balance: input.balance, annualRate: input.annualRate, monthlyPayment: input.monthlyPayment },
    output: {
      balance: money(balance),
      monthlyRate: D(r).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber(),
      monthsToPayoff: monthsWhole,
      totalPaid: money(totalPaidExact),
      totalInterest: money(interestExact),
      neverPaysOff,
    },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { monthlyRateExact: str(r), totalPaidExact: str(totalPaidExact), totalInterestExact: str(interestExact) },
    warnings,
  })
}
