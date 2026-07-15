// src/lib/analytics/forecast.ts
// Advanced-forecasting math — PURE functions, no DB import, safe on client+server.
// The page fetches the real inputs (open opportunities + historical monthly
// commission) and calls these; the ForecastSettings editor reuses the stage list
// and defaults. Stage → close-probability is a modeling ASSUMPTION (guardrail
// §2.3): the defaults below are editable config, flagged is_assumption, and every
// surface that shows them renders the "config default — verify" badge.

// Open pipeline stages (placed_issued / lost are terminal and excluded).
export const FORECAST_STAGES = [
  'prospect',
  'fact_find',
  'quoted_proposed',
  'application',
  'underwriting_suitability',
] as const

export type ForecastStage = (typeof FORECAST_STAGES)[number]

// Conservative, clearly-labeled config defaults (NOT Farmers-published figures).
export const DEFAULT_STAGE_PROBABILITIES: Record<ForecastStage, number> = {
  prospect: 0.1,
  fact_find: 0.25,
  quoted_proposed: 0.45,
  application: 0.7,
  underwriting_suitability: 0.85,
}

export function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ')
}

/** Coerce a stored probabilities map to a complete, clamped 0..1 record. */
export function normalizeProbabilities(raw: unknown): Record<ForecastStage, number> {
  const src = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>
  const out = {} as Record<ForecastStage, number>
  for (const stage of FORECAST_STAGES) {
    const v = Number(src[stage])
    out[stage] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_STAGE_PROBABILITIES[stage]
  }
  return out
}

export interface OpenOpp {
  stage: string
  expected_commission: number | null
  is_security: boolean
}

export interface StageBreakdownRow {
  stage: ForecastStage
  probability: number
  open_count: number
  expected: number // un-weighted expected_commission in this stage
  weighted: number // expected × probability
}

export interface WeightedPipeline {
  rows: StageBreakdownRow[]
  total_expected: number
  total_weighted: number
  securities_weighted: number // subset that is is_security (production tracking only)
}

/**
 * Probability-weight the open pipeline. Securities-flagged expected commission is
 * still counted for the FSA's own production forecast (firewall permits tracking
 * stage + expected commission) but surfaced separately so it is never conflated
 * with an automated/client-facing surface.
 */
export function weightedPipeline(
  opps: OpenOpp[],
  probabilities: Record<ForecastStage, number>,
): WeightedPipeline {
  const acc = new Map<ForecastStage, StageBreakdownRow>()
  for (const stage of FORECAST_STAGES) {
    acc.set(stage, { stage, probability: probabilities[stage], open_count: 0, expected: 0, weighted: 0 })
  }
  let securitiesWeighted = 0
  for (const o of opps) {
    if (!(FORECAST_STAGES as readonly string[]).includes(o.stage)) continue
    const row = acc.get(o.stage as ForecastStage)!
    const expected = Number(o.expected_commission) || 0
    row.open_count += 1
    row.expected += expected
    const w = expected * row.probability
    row.weighted += w
    if (o.is_security) securitiesWeighted += w
  }
  const rows = FORECAST_STAGES.map((s) => acc.get(s)!)
  const total_expected = rows.reduce((a, r) => a + r.expected, 0)
  const total_weighted = rows.reduce((a, r) => a + r.weighted, 0)
  return { rows, total_expected, total_weighted, securities_weighted: securitiesWeighted }
}

export interface MonthPoint {
  month: string // YYYY-MM
  fsa_amount: number
}

export interface RunRate {
  history: MonthPoint[] // trailing actuals used
  avg_monthly: number
  trend_monthly: number // slope from least-squares over history
  projection: MonthPoint[] // projected forward `horizon` months
  projected_total: number
}

/** Add N months to a YYYY-MM string (pure — no Date-now dependence on the label). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const zero = (y * 12 + (m - 1)) + n
  const yy = Math.floor(zero / 12)
  const mm = (zero % 12) + 1
  return `${yy}-${String(mm).padStart(2, '0')}`
}

/**
 * Run-rate projection: average the trailing `lookback` months and fit a simple
 * linear trend, then project `horizon` months forward. History is expected to be
 * sorted ascending by month and already filtered to the window the caller wants.
 */
export function runRate(history: MonthPoint[], horizon: number, lookback = 6): RunRate {
  const trailing = history.slice(-lookback)
  const n = trailing.length
  const avg = n ? trailing.reduce((a, p) => a + p.fsa_amount, 0) / n : 0

  // Least-squares slope over the trailing window (x = 0..n-1).
  let slope = 0
  if (n >= 2) {
    const xMean = (n - 1) / 2
    const yMean = avg
    let num = 0
    let den = 0
    trailing.forEach((p, i) => {
      num += (i - xMean) * (p.fsa_amount - yMean)
      den += (i - xMean) * (i - xMean)
    })
    slope = den ? num / den : 0
  }

  const lastMonth = history.length ? history[history.length - 1].month : '2025-01'
  const lastValue = n ? trailing[n - 1].fsa_amount : 0
  const projection: MonthPoint[] = []
  for (let i = 1; i <= horizon; i++) {
    // Blend the flat average with the trend so a short/noisy history stays sane.
    const projected = Math.max(0, (avg + lastValue) / 2 + slope * i)
    projection.push({ month: addMonths(lastMonth, i), fsa_amount: Math.round(projected) })
  }
  const projected_total = projection.reduce((a, p) => a + p.fsa_amount, 0)
  return { history: trailing, avg_monthly: avg, trend_monthly: slope, projection, projected_total }
}
