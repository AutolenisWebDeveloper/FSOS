// src/lib/fna/engine/formulas/future-value.ts
// PRIMITIVE: future value of a lump sum plus an ordinary annuity (level periodic
// contribution made at period end). Pure decimal.js math (ADR-015). Shared by the
// retirement and education projections; also exposed as a standalone formula.
//
//   FV = PV·(1+r)^n + PMT·[((1+r)^n − 1) / r]      (r ≠ 0)
//   FV = PV + PMT·n                                 (r = 0)

import { D, Decimal, money, str, MONEY_ROUNDING } from '../money'
import { buildResult, type CalcContext, type CalcResult } from '../types'

export const FUTURE_VALUE_ID = 'future_value'
export const FUTURE_VALUE_VERSION = '1.0.0'

export interface FutureValueInput {
  /** Present lump sum. */
  presentValue: number
  /** Rate per period as a decimal fraction (e.g. 0.06). */
  ratePerPeriod: number
  /** Number of periods (rounded down to a whole period if fractional). */
  periods: number
  /** Level contribution per period, paid at period end. Default 0. */
  payment?: number
}

export interface FutureValueOutput {
  futureValue: number
}

/** Raw Decimal future value — reused internally without envelope overhead. */
export function futureValueDecimal(input: FutureValueInput): Decimal {
  const pv = D(input.presentValue)
  const r = D(input.ratePerPeriod)
  const n = Math.max(0, Math.floor(input.periods))
  const pmt = D(input.payment ?? 0)

  if (r.isZero()) {
    return pv.plus(pmt.times(n))
  }
  const growth = r.plus(1).pow(n) // (1+r)^n
  const fvLump = pv.times(growth)
  const fvAnnuity = pmt.times(growth.minus(1).dividedBy(r))
  return fvLump.plus(fvAnnuity)
}

export function futureValue(input: FutureValueInput, ctx: CalcContext): CalcResult<FutureValueOutput> {
  const n = Math.max(0, Math.floor(input.periods))
  const growth = D(input.ratePerPeriod).plus(1).pow(n)
  const fv = futureValueDecimal(input)

  return buildResult<FutureValueOutput>({
    formulaId: FUTURE_VALUE_ID,
    formulaVersion: FUTURE_VALUE_VERSION,
    inputs: {
      presentValue: input.presentValue,
      ratePerPeriod: input.ratePerPeriod,
      periods: n,
      payment: input.payment ?? 0,
    },
    output: { futureValue: money(fv) },
    ctx,
    rounding: MONEY_ROUNDING,
    intermediates: { growthFactor: str(growth), futureValueExact: str(fv) },
  })
}
