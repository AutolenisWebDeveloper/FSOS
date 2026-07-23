// src/lib/fna/engine/formulas/present-value.ts
// PRIMITIVE: present value of a future lump sum and of an ordinary annuity (level
// periodic payment at period end). Pure decimal.js math (ADR-015). The annuity PV
// is the backbone of income-replacement, survivor, and retirement-need math.
//
//   PV(lump)    = FV / (1+r)^n
//   PV(annuity) = PMT · [1 − (1+r)^−n] / r        (r ≠ 0)
//   PV(annuity) = PMT · n                          (r = 0)

import { D, Decimal, money, str, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult } from '../types'

export const PRESENT_VALUE_ID = 'present_value'
export const PRESENT_VALUE_VERSION = '1.0.0'

export interface PresentValueInput {
  /** Future lump sum to discount. Default 0. */
  futureValue?: number
  /** Level payment per period (ordinary annuity, paid at period end). Default 0. */
  payment?: number
  /** Discount rate per period as a decimal fraction. */
  ratePerPeriod: number
  /** Number of periods (rounded down to a whole period if fractional). */
  periods: number
}

export interface PresentValueOutput {
  presentValue: number
}

/** PV of a level ordinary annuity as a raw Decimal — reused internally. */
export function annuityPresentValueDecimal(payment: number, ratePerPeriod: number, periods: number): Decimal {
  const pmt = D(payment)
  const r = D(ratePerPeriod)
  const n = Math.max(0, Math.floor(periods))
  if (r.isZero()) return pmt.times(n)
  const discount = r.plus(1).pow(-n) // (1+r)^-n
  return pmt.times(new Decimal(1).minus(discount).dividedBy(r))
}

/** Combined PV (lump + annuity) as a raw Decimal — reused internally. */
export function presentValueDecimal(input: PresentValueInput): Decimal {
  const r = D(input.ratePerPeriod)
  const n = Math.max(0, Math.floor(input.periods))
  const pvLump = D(input.futureValue ?? 0).dividedBy(r.plus(1).pow(n))
  const pvAnnuity = annuityPresentValueDecimal(input.payment ?? 0, input.ratePerPeriod, n)
  return pvLump.plus(pvAnnuity)
}

export function presentValue(input: PresentValueInput, ctx: CalcContext): CalcResult<PresentValueOutput> {
  const n = Math.max(0, Math.floor(input.periods))
  const pv = presentValueDecimal(input)
  const discount = D(input.ratePerPeriod).plus(1).pow(-n)

  return buildResult<PresentValueOutput>({
    formulaId: PRESENT_VALUE_ID,
    formulaVersion: PRESENT_VALUE_VERSION,
    inputs: {
      futureValue: input.futureValue ?? 0,
      payment: input.payment ?? 0,
      ratePerPeriod: input.ratePerPeriod,
      periods: n,
    },
    output: { presentValue: money(pv) },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { discountFactor: str(discount), presentValueExact: str(pv) },
  })
}
