// Cross-Sell command-center data. Server-only. Every figure is DB-derived via
// load(); nothing here recommends a product — cross-sell is framed as a coverage
// GAP / review opportunity (guardrail §2.2). Revenue is an assumption-based
// estimate (guardrail §2.3), rendered with an AssumptionBadge in the UI.

import { load } from '@/lib/data/query'
import { estPipelineValue } from './assumptions'

export interface CrossSellGap {
  household_id: string
  primary_name: string | null
  referring_agency_id: string | null
  families_held: string[] | null
  has_life: boolean
  next_best_line: string | null
  gap_count: number
  score: number
}

interface Activity {
  id: string
  entity_id: string | null
  kind: string | null
  note: string | null
  created_at: string
}

interface AgencyTarget {
  id: string
  agency_name: string | null
  owner_name: string | null
  pc_book_policies: number | null
  life_policies_in_force: number | null
  life_penetration_pct: number | null
  target_score: number | null
}

interface ReviewRow {
  id: string
  household_id: string | null
  type: string | null
  stage: string | null
  scheduled_at: string | null
}

export interface CrossSellDashboard {
  gaps: CrossSellGap[]
  agencyNames: Map<string, string>
  targets: AgencyTarget[]
  activities: Activity[]
  reviews: ReviewRow[]
  kpis: {
    totalGaps: number
    noLife: number
    agenciesParticipating: number
    contacted: number
    invited: number
    reviewsScheduled: number
    conversionRate: number
    estRevenue: number
  }
  lineDistribution: { label: string; value: number }[]
  gapIntensity: { label: string; value: number }[]
  agencyLeaderboard: { id: string; name: string; opportunities: number; penetration: number | null }[]
}

const CROSSSELL_PREFIX = 'crosssell_'

export async function loadCrossSellDashboard(): Promise<
  { ok: true; data: CrossSellDashboard } | { ok: false; kind: 'not_configured' | 'error'; message: string }
> {
  const [gapsR, targetsR, actsR, reviewsR] = await Promise.all([
    load<CrossSellGap[]>(
      (db) => db.from('v_cross_sell_gaps').select('*').order('score', { ascending: false }).limit(2000),
      [],
    ),
    load<AgencyTarget[]>(
      (db) => db.from('v_crosssell_targets').select('*').order('target_score', { ascending: false }).limit(200),
      [],
    ),
    load<Activity[]>(
      (db) =>
        db
          .from('activities')
          .select('id, entity_id, kind, note, created_at')
          .eq('entity_type', 'household')
          .like('kind', `${CROSSSELL_PREFIX}%`)
          .order('created_at', { ascending: false })
          .limit(3000),
      [],
    ),
    load<ReviewRow[]>(
      (db) =>
        db
          .from('reviews')
          .select('id, household_id, type, stage, scheduled_at')
          .in('type', ['coverage', 'policy'])
          .is('deleted_at', null)
          .order('scheduled_at', { ascending: true, nullsFirst: false })
          .limit(500),
      [],
    ),
  ])

  // The gaps view is the spine of this page; if it fails, surface that.
  if (!gapsR.ok) return { ok: false, kind: gapsR.kind, message: gapsR.message }

  const gaps = gapsR.data
  const targets = targetsR.ok ? targetsR.data : []
  const activities = actsR.ok ? actsR.data : []
  const reviews = reviewsR.ok ? reviewsR.data : []

  // Agency names for leaderboard/labels: from the penetration view, keyed by id.
  const agencyNames = new Map<string, string>()
  for (const t of targets) if (t.id && t.agency_name) agencyNames.set(t.id, t.agency_name)

  // Outreach state, derived from the append-only activity log.
  const action = (a: Activity) => (a.kind ? a.kind.slice(CROSSSELL_PREFIX.length) : '')
  const contactedSet = new Set(activities.map((a) => a.entity_id).filter(Boolean) as string[])
  const invitedSet = new Set(
    activities.filter((a) => ['invite', 'educate'].includes(action(a))).map((a) => a.entity_id).filter(Boolean) as string[],
  )
  const reviewsScheduled = activities.filter((a) => action(a) === 'schedule').length

  const totalGaps = gaps.length
  const noLife = gaps.filter((g) => !g.has_life).length
  const agencyGapCounts = new Map<string, number>()
  for (const g of gaps) {
    if (!g.referring_agency_id) continue
    agencyGapCounts.set(g.referring_agency_id, (agencyGapCounts.get(g.referring_agency_id) ?? 0) + 1)
  }
  const agenciesParticipating = agencyGapCounts.size

  // Coverage-gap mix by next-best line (a GAP, not a recommendation).
  const lineCounts = new Map<string, number>()
  for (const g of gaps) {
    const line = g.next_best_line ?? 'unspecified'
    lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1)
  }
  const lineDistribution = [...lineCounts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  // Gap intensity (how many coverage lines are open per household).
  const intensity = { '1 gap': 0, '2 gaps': 0, '3+ gaps': 0 }
  for (const g of gaps) {
    if (g.gap_count >= 3) intensity['3+ gaps']++
    else if (g.gap_count === 2) intensity['2 gaps']++
    else intensity['1 gap']++
  }
  const gapIntensity = Object.entries(intensity).map(([label, value]) => ({ label, value }))

  const agencyLeaderboard = [...agencyGapCounts.entries()]
    .map(([id, opportunities]) => {
      const target = targets.find((t) => t.id === id)
      return {
        id,
        name: agencyNames.get(id) ?? 'Unlinked agency',
        opportunities,
        penetration: target?.life_penetration_pct ?? null,
      }
    })
    .sort((a, b) => b.opportunities - a.opportunities)
    .slice(0, 8)

  const conversionRate = totalGaps > 0 ? Math.round((reviewsScheduled / totalGaps) * 100) : 0

  return {
    ok: true,
    data: {
      gaps,
      agencyNames,
      targets,
      activities,
      reviews,
      kpis: {
        totalGaps,
        noLife,
        agenciesParticipating,
        contacted: contactedSet.size,
        invited: invitedSet.size,
        reviewsScheduled,
        conversionRate,
        estRevenue: estPipelineValue(totalGaps),
      },
      lineDistribution,
      gapIntensity,
      agencyLeaderboard,
    },
  }
}
