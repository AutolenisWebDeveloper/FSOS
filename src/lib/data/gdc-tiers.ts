// src/lib/data/gdc-tiers.ts
// PURE GDC tier math — no I/O, no imports. This is the config-driven core the GDC
// dashboard (/app/commissions/gdc), the sidebar tier card, and the tier-math proof
// test (tests/gdc-tier.test.mjs) all share. Keeping it dependency-free is what makes
// it unit-testable without a live Supabase (same pattern as the compliance cores).
//
// GUARDRAIL 3: tier thresholds/payouts are assumption-flagged config, never a
// Farmers-published figure. This module computes against whatever config is passed —
// it invents no defaults of its own.

export interface GdcTier {
  tier_no: number
  label: string
  min_gdc: number
  /** Inclusive ceiling; null = open-ended top tier. */
  max_gdc: number | null
  payout_pct: number
  is_assumption: boolean
  note?: string | null
}

/** Config tiers sorted ascending by floor — the canonical order for all tier math. */
export function sortTiers(tiers: GdcTier[]): GdcTier[] {
  return [...tiers].sort((a, b) => a.min_gdc - b.min_gdc)
}

/**
 * The tier a given rolling-12mo GDC falls into. A tier matches when
 * gdc >= min_gdc AND (max_gdc is null OR gdc <= max_gdc). If nothing matches
 * (e.g. a gap in config), fall back to the highest floor at or below gdc, then
 * to the lowest tier — never return null when any tier exists.
 */
export function pickGdcTier(gdc: number, tiers: GdcTier[]): GdcTier | null {
  if (tiers.length === 0) return null
  const sorted = sortTiers(tiers)
  const exact = sorted.find(
    (t) => gdc >= t.min_gdc && (t.max_gdc === null || gdc <= t.max_gdc),
  )
  if (exact) return exact
  // Below the lowest floor → lowest tier; above/into a gap → highest floor ≤ gdc.
  let chosen = sorted[0]
  for (const t of sorted) {
    if (gdc >= t.min_gdc) chosen = t
  }
  return chosen
}

/** The next tier up from the current one (by floor), or null if already top. */
export function nextGdcTier(current: GdcTier | null, tiers: GdcTier[]): GdcTier | null {
  if (!current) return null
  const sorted = sortTiers(tiers)
  const idx = sorted.findIndex((t) => t.tier_no === current.tier_no)
  if (idx < 0 || idx >= sorted.length - 1) return null
  return sorted[idx + 1]
}

export interface GdcTierMath {
  gdc: number
  current: GdcTier | null
  next: GdcTier | null
  /** Dollars of additional GDC needed to reach the next tier (0 if at top / none). */
  distanceToNext: number
  /** FSA payout at the current tier for the given GDC (dollars). */
  estimatedPayout: number
}

/** One-shot tier computation for a rolling-12mo GDC total against config tiers. */
export function computeGdcTier(gdc: number, tiers: GdcTier[]): GdcTierMath {
  const current = pickGdcTier(gdc, tiers)
  const next = nextGdcTier(current, tiers)
  const distanceToNext = next ? Math.max(0, next.min_gdc - gdc) : 0
  const estimatedPayout = current ? round2((gdc * current.payout_pct) / 100) : 0
  return { gdc, current, next, distanceToNext, estimatedPayout }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
