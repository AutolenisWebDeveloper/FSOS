// src/lib/fna/engine/money.ts
// PURE money primitives for the FNA calculation engine (ADR-015). Every monetary
// and rate operation in the engine goes through decimal.js — native JS
// floating-point is NEVER used for money. No I/O, no ambient clock; safe to
// compile standalone and unit-test offline (tests/fna-engine.test.mjs).
//
// GUARDRAIL: this module computes; it invents no figures and no assumptions.

import Decimal from 'decimal.js'

// Deterministic, generous precision. 34 significant digits comfortably covers
// long compounding chains without rounding drift; the final money rounding is
// applied explicitly at the edge via money().
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

/** Currency of record for the engine. Single-currency by design (USD). */
export const CURRENCY = 'USD' as const
export type Currency = typeof CURRENCY

/** The declared rounding rule for every money output, recorded in each result. */
export const MONEY_ROUNDING = 'ROUND_HALF_UP@2dp' as const
/** Rounding rule for rates/ratios recorded alongside rate outputs. */
export const RATE_ROUNDING = 'ROUND_HALF_UP@6dp' as const

export type DecimalInput = Decimal | number | string

/** Construct a Decimal from a number/string/Decimal. Rejects non-finite input. */
export function D(value: DecimalInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value)
  if (!d.isFinite()) throw new Error('money: non-finite value')
  return d
}

/** Sum a list of values with no floating-point accumulation. Empty → 0. */
export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0))
}

/** Round a Decimal to cents (half-up) and return a JS number for display/storage. */
export function money(value: DecimalInput): number {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
}

/** Round a rate/ratio to 6dp (half-up) and return a JS number. */
export function rate(value: DecimalInput): number {
  return D(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toNumber()
}

/** Serialize a Decimal to a stable string for the `intermediates` envelope. */
export function str(value: DecimalInput): string {
  return D(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
}

/** `part / whole` as a Decimal ratio; whole == 0 → 0 (never NaN/Infinity). */
export function ratio(part: DecimalInput, whole: DecimalInput): Decimal {
  const w = D(whole)
  return w.isZero() ? new Decimal(0) : D(part).dividedBy(w)
}

/** `base * pct%` (pct expressed as a percentage, e.g. 60 for 60%). */
export function pctOf(base: DecimalInput, pct: DecimalInput): Decimal {
  return D(base).times(D(pct)).dividedBy(100)
}

/** max(0, value) as a Decimal — a shortfall/gap floor used across formulas. */
export function atLeastZero(value: DecimalInput): Decimal {
  const d = D(value)
  return d.isNegative() ? new Decimal(0) : d
}
