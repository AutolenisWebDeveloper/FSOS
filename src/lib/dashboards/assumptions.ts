// Production Operations estimate defaults (GUARDRAIL §2.3 — no invented Farmers data).
//
// Farmers/FFS do not publish per-line average premiums or the FSA commission rate.
// Any revenue/premium ESTIMATE derived from an opportunity/gap COUNT (rather than a
// real `opportunities.expected_commission` row) uses these editable defaults and MUST
// render an <AssumptionBadge/> ("config default — verify") beside it. Never present
// these as Farmers-published facts. Real commission figures always come from the
// `commissions` / `opportunities` tables; these only fill gaps where no real figure
// exists yet.
//
// To change: edit here (or wire to /super/ai/policies config later). Values are
// deliberately conservative placeholders, not quotes.

export interface EstimateDefaults {
  /** Assumed average first-year annualized premium per placed life/financial opportunity. */
  avgAnnualPremium: number
  /** Assumed blended FSA commission as a fraction of first-year premium. */
  fsaCommissionRate: number
  /** Assumed identified-gap → placed conversion rate (for pipeline value sizing). */
  gapConversionRate: number
  /** Every field here is an unverified assumption. */
  is_assumption: true
}

export const ESTIMATE_DEFAULTS: EstimateDefaults = {
  avgAnnualPremium: 1800,
  fsaCommissionRate: 0.5,
  gapConversionRate: 0.08,
  is_assumption: true,
}

/** Estimated first-year premium across N opportunities (assumption-based). */
export function estPremium(count: number, d: EstimateDefaults = ESTIMATE_DEFAULTS): number {
  return Math.round(count * d.avgAnnualPremium)
}

/** Estimated FSA revenue across N opportunities (assumption-based). */
export function estRevenue(count: number, d: EstimateDefaults = ESTIMATE_DEFAULTS): number {
  return Math.round(count * d.avgAnnualPremium * d.fsaCommissionRate)
}

/** Estimated revenue from an identified-gap pool, weighted by assumed conversion. */
export function estPipelineValue(gapCount: number, d: EstimateDefaults = ESTIMATE_DEFAULTS): number {
  return Math.round(gapCount * d.gapConversionRate * d.avgAnnualPremium * d.fsaCommissionRate)
}
