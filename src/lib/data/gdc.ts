// src/lib/data/gdc.ts
// Server-side loaders for the GDC (Gross Dealer Concession) surfaces:
//   • loadGdcTierState() — rolling-12mo GDC + current/next tier (sidebar gold card)
//   • loadGdcSummary()   — the above + estimated-FSA-payout pipeline by stage (A1 tab)
//
// GDC is the FSA's own rolling-12mo production total; it drives the payout tier.
// Tiers are assumption-flagged config (docs/legacy-port.md §2.2) loaded from
// gdc_tiers — this module invents no thresholds. Production tracking of commission
// (including is_security production) is permitted under the securities firewall
// (CLAUDE.md §2.1) — no securities substantive data is read here.

import { load } from '@/lib/data/query'
import { computeGdcTier, sortTiers, type GdcTier, type GdcTierMath } from '@/lib/data/gdc-tiers'

const ROLLING_DAYS = 365
// Pipeline = live opportunities; a lost opp contributes no future GDC.
const CLOSED_STAGES = new Set(['lost'])

interface RawTier {
  tier_no: number
  label: string
  min_gdc: number
  max_gdc: number | null
  payout_pct: number
  is_assumption: boolean
  note: string | null
}
interface RawComm {
  total_commission: number | null
  is_security: boolean
  paid_on: string | null
  created_at: string
}
interface RawOpp {
  stage: string
  expected_commission: number | null
  is_security: boolean
}

export interface GdcPipelineStage {
  stage: string
  count: number
  expected: number
  /** Estimated FSA payout at the current tier (expected × payout%). */
  estPayout: number
}

export interface GdcTierState {
  math: GdcTierMath
  tiers: GdcTier[]
  rolling12: number
  /** Inclusive start of the rolling window (ISO date). */
  windowStart: string
}

export interface GdcSummary extends GdcTierState {
  pipeline: GdcPipelineStage[]
  pipelineExpectedTotal: number
  pipelineEstPayoutTotal: number
}

type LoadOutcome<T> = { ok: false; notConfigured: boolean; message: string } | ({ ok: true } & T)

function windowStartIso(): string {
  const d = new Date()
  d.setDate(d.getDate() - ROLLING_DAYS)
  return d.toISOString().slice(0, 10)
}

/** Effective production date for a commission row (paid date, else booked date). */
function effectiveDate(c: RawComm): string {
  return c.paid_on ?? c.created_at.slice(0, 10)
}

/** Tiers + rolling-12mo GDC + tier math. Shared by the card and the full summary. */
export async function loadGdcTierState(): Promise<LoadOutcome<GdcTierState>> {
  const [tiersRes, commsRes] = await Promise.all([
    load<RawTier[]>(
      (db) =>
        db
          .from('gdc_tiers')
          .select('tier_no, label, min_gdc, max_gdc, payout_pct, is_assumption, note')
          .eq('active', true)
          .order('min_gdc', { ascending: true }),
      [],
    ),
    load<RawComm[]>(
      (db) => db.from('commissions').select('total_commission, is_security, paid_on, created_at'),
      [],
    ),
  ])

  if (!tiersRes.ok)
    return { ok: false, notConfigured: tiersRes.kind === 'not_configured', message: tiersRes.message }

  const tiers: GdcTier[] = sortTiers(
    tiersRes.data.map((t) => ({
      tier_no: t.tier_no,
      label: t.label,
      min_gdc: Number(t.min_gdc ?? 0),
      max_gdc: t.max_gdc === null || t.max_gdc === undefined ? null : Number(t.max_gdc),
      payout_pct: Number(t.payout_pct ?? 0),
      is_assumption: t.is_assumption,
      note: t.note,
    })),
  )

  const windowStart = windowStartIso()
  const rolling12 = (commsRes.ok ? commsRes.data : [])
    .filter((c) => effectiveDate(c) >= windowStart)
    .reduce((s, c) => s + Number(c.total_commission ?? 0), 0)

  const math = computeGdcTier(round2(rolling12), tiers)
  return { ok: true, math, tiers, rolling12: round2(rolling12), windowStart }
}

/** Full GDC dashboard payload — tier state + estimated-payout pipeline by stage. */
export async function loadGdcSummary(): Promise<LoadOutcome<GdcSummary>> {
  const state = await loadGdcTierState()
  if (!state.ok) return state

  const oppsRes = await load<RawOpp[]>(
    (db) => db.from('opportunities').select('stage, expected_commission, is_security'),
    [],
  )
  const payoutPct = state.math.current?.payout_pct ?? 0

  const byStage = new Map<string, { count: number; expected: number }>()
  for (const o of oppsRes.ok ? oppsRes.data : []) {
    if (CLOSED_STAGES.has(o.stage)) continue
    const cur = byStage.get(o.stage) ?? { count: 0, expected: 0 }
    cur.count += 1
    cur.expected += Number(o.expected_commission ?? 0)
    byStage.set(o.stage, cur)
  }

  const pipeline: GdcPipelineStage[] = Array.from(byStage.entries())
    .map(([stage, v]) => ({
      stage,
      count: v.count,
      expected: round2(v.expected),
      estPayout: round2((v.expected * payoutPct) / 100),
    }))
    .sort((a, b) => b.expected - a.expected)

  // `state` is the ok branch here (guarded above) and already carries ok: true.
  return {
    ...state,
    pipeline,
    pipelineExpectedTotal: round2(pipeline.reduce((s, p) => s + p.expected, 0)),
    pipelineEstPayoutTotal: round2(pipeline.reduce((s, p) => s + p.estPayout, 0)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
