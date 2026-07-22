// src/lib/revenue/center.ts
// The PURE composition view-model for the Revenue Center (§21) — the one net-new
// top-level page, a COMPOSED view over existing data (no new source of truth).
// Deliberately DB-free (imports nothing) so the revenue roll-ups, the workflow
// attribution, the funnels, at-risk detection, and the data-quality warnings are
// unit-provable in isolation.
//
// It composes `opportunities` (with the origination `source` tags from slices 2-4 —
// cross_sell / win_back / term_conversion) into an honest revenue picture. The page
// layers on the EXISTING Expected/Weighted math (lib/analytics/forecast.ts), Actual
// (v_commission_monthly), Potential (lib/dashboards/assumptions.ts, assumption-badged),
// and the appointment funnel (lib/appointments/recovery.ts).
//
// GUARDRAILS baked in here:
//   • Securities firewall — securities opportunities are separated out of every
//     automated revenue total and reported on their own line (never mixed in).
//   • Honest revenue (§21) — Actual / Expected / Weighted / Projected / Potential are
//     distinct; nothing here fabricates a figure or presents an estimate as earned. A
//     missing commission is surfaced as a data-quality warning, not invented (§4.3).

/** Terminal opportunity stages. */
export const WON_STAGE = 'placed_issued'
export const LOST_STAGE = 'lost'

/** Open (non-terminal) stages, in progression order. */
export const OPEN_STAGES = ['prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability'] as const

/** Full stage order (open → won) for the conversion funnel. */
export const STAGE_ORDER = [...OPEN_STAGES, WON_STAGE] as const

/** Human labels for the origination sources (slices 2-4 + existing paths). */
export const SOURCE_LABELS: Record<string, string> = {
  cross_sell: 'Cross-Sell',
  win_back: 'Life Win-Back',
  term_conversion: 'Term Conversion',
  referral: 'Referral',
  review: 'Review',
  manual: 'Manual',
  unattributed: 'Unattributed',
}

/** The opportunities columns the Revenue Center composes. */
export interface OppRow {
  id: string
  stage: string
  is_security: boolean
  source: string | null
  premium: number | null
  expected_commission: number | null
  actual_commission: number | null
  household_id: string | null
  contact_id: string | null
  updated_at: string | null
}

export type OppClass = 'won' | 'lost' | 'open'

const num = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** Classify an opportunity by its terminal-vs-open stage. */
export function classifyOpp(o: OppRow): OppClass {
  if (o.stage === WON_STAGE) return 'won'
  if (o.stage === LOST_STAGE) return 'lost'
  return 'open'
}

// ─── Revenue summary ──────────────────────────────────────────────────────────

export interface RevenueSummary {
  openCount: number
  wonCount: number
  lostCount: number
  /** Sum of expected_commission over OPEN, non-securities opportunities. */
  expectedOpen: number
  /** Open securities expected — tracked separately (firewall), never in expectedOpen. */
  expectedSecurities: number
  /** Sum of actual_commission over WON, non-securities opportunities. */
  actualWon: number
}

export function revenueSummary(opps: OppRow[]): RevenueSummary {
  const s: RevenueSummary = { openCount: 0, wonCount: 0, lostCount: 0, expectedOpen: 0, expectedSecurities: 0, actualWon: 0 }
  for (const o of opps) {
    const cls = classifyOpp(o)
    if (cls === 'open') {
      s.openCount += 1
      if (o.is_security) s.expectedSecurities += num(o.expected_commission)
      else s.expectedOpen += num(o.expected_commission)
    } else if (cls === 'won') {
      s.wonCount += 1
      if (!o.is_security) s.actualWon += num(o.actual_commission)
    } else {
      s.lostCount += 1
    }
  }
  return s
}

// ─── Revenue by workflow (source attribution) ─────────────────────────────────

export interface SourceRevenue {
  source: string
  label: string
  openCount: number
  expected: number
  wonCount: number
  actual: number
}

/**
 * Attribute open expected + won actual commission by origination source (the payoff of
 * slices 2-4). Securities are excluded (firewall); a null source buckets as
 * 'unattributed' (never dropped). Sorted by expected + actual desc.
 */
export function revenueBySource(opps: OppRow[]): SourceRevenue[] {
  const map = new Map<string, SourceRevenue>()
  for (const o of opps) {
    if (o.is_security) continue
    const key = o.source && o.source.length > 0 ? o.source : 'unattributed'
    let row = map.get(key)
    if (!row) {
      row = { source: key, label: SOURCE_LABELS[key] ?? key, openCount: 0, expected: 0, wonCount: 0, actual: 0 }
      map.set(key, row)
    }
    const cls = classifyOpp(o)
    if (cls === 'open') {
      row.openCount += 1
      row.expected += num(o.expected_commission)
    } else if (cls === 'won') {
      row.wonCount += 1
      row.actual += num(o.actual_commission)
    }
  }
  return [...map.values()].sort((a, b) => b.expected + b.actual - (a.expected + a.actual))
}

// ─── Pipeline + conversion funnels ────────────────────────────────────────────

export interface StageBucket {
  stage: string
  count: number
  expected: number
}

/** Open, non-securities opportunities bucketed by stage, in progression order. */
export function pipelineByStage(opps: OppRow[]): StageBucket[] {
  const buckets: StageBucket[] = OPEN_STAGES.map((stage) => ({ stage: stage as string, count: 0, expected: 0 }))
  const index = new Map<string, number>(buckets.map((b, i) => [b.stage, i]))
  for (const o of opps) {
    if (o.is_security) continue
    if (classifyOpp(o) !== 'open') continue
    const i = index.get(o.stage)
    if (i === undefined) continue
    buckets[i].count += 1
    buckets[i].expected += num(o.expected_commission)
  }
  return buckets
}

export interface FunnelStep {
  stage: string
  count: number
}

/**
 * Conversion funnel — count of (non-lost) opportunities at OR PAST each stage. Because
 * progression is monotonic, the counts never increase down the funnel. Securities are
 * included here (this is a flow count, not a revenue figure).
 */
export function conversionFunnel(opps: OppRow[]): FunnelStep[] {
  const rank = new Map<string, number>(STAGE_ORDER.map((s, i) => [s, i]))
  return STAGE_ORDER.map((stage, i) => {
    let count = 0
    for (const o of opps) {
      if (o.stage === LOST_STAGE) continue
      const r = rank.get(o.stage)
      if (r !== undefined && r >= i) count += 1
    }
    return { stage, count }
  })
}

// ─── Revenue at risk ──────────────────────────────────────────────────────────

export interface AtRisk {
  stalledCount: number
  stalledExpected: number
  lostCount: number
  lostExpected: number
}

/**
 * Revenue at risk: OPEN opportunities not updated within `staleDays` (stalled), plus
 * LOST opportunities' forgone expected commission. `now` is passed in for testability.
 */
export function revenueAtRisk(opps: OppRow[], now: Date, staleDays = 30): AtRisk {
  const cutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000
  const r: AtRisk = { stalledCount: 0, stalledExpected: 0, lostCount: 0, lostExpected: 0 }
  for (const o of opps) {
    const cls = classifyOpp(o)
    if (cls === 'open') {
      const updated = o.updated_at ? new Date(o.updated_at).getTime() : NaN
      if (!Number.isNaN(updated) && updated < cutoff) {
        r.stalledCount += 1
        r.stalledExpected += num(o.expected_commission)
      }
    } else if (cls === 'lost') {
      r.lostCount += 1
      r.lostExpected += num(o.expected_commission)
    }
  }
  return r
}

// ─── Attribution + data quality ───────────────────────────────────────────────

export interface AttributionQuality {
  total: number
  withSource: number
  withRevenue: number
  sourcePct: number
  revenuePct: number
}

/** How well the opportunity book is attributed (has a source) and priced (has a value). */
export function attributionQuality(opps: OppRow[]): AttributionQuality {
  const total = opps.length
  let withSource = 0
  let withRevenue = 0
  for (const o of opps) {
    if (o.source && o.source.length > 0) withSource += 1
    if (num(o.expected_commission) > 0 || num(o.actual_commission) > 0) withRevenue += 1
  }
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  return { total, withSource, withRevenue, sourcePct: pct(withSource), revenuePct: pct(withRevenue) }
}

export interface DataQualityWarning {
  kind: 'unattributed' | 'missing_revenue' | 'unresolved_identity'
  count: number
  note: string
}

/**
 * Surface (never hide) opportunity data-quality gaps: no origination source, no
 * expected commission on an open opportunity (unverified value), and no household or
 * contact link (unresolved identity — the AI must not act on these, §17).
 */
export function dataQualityWarnings(opps: OppRow[]): DataQualityWarning[] {
  let unattributed = 0
  let missingRevenue = 0
  let unresolved = 0
  for (const o of opps) {
    if (!o.source || o.source.length === 0) unattributed += 1
    if (classifyOpp(o) === 'open' && num(o.expected_commission) <= 0) missingRevenue += 1
    if (!o.household_id && !o.contact_id) unresolved += 1
  }
  const out: DataQualityWarning[] = []
  if (unattributed > 0) out.push({ kind: 'unattributed', count: unattributed, note: 'opportunities have no origination source' })
  if (missingRevenue > 0) out.push({ kind: 'missing_revenue', count: missingRevenue, note: 'open opportunities have no expected commission (unverified value)' })
  if (unresolved > 0) out.push({ kind: 'unresolved_identity', count: unresolved, note: 'opportunities are not linked to a household or contact' })
  return out
}
