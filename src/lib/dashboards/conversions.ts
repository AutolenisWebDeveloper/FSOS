// Life Conversion command-center data. Server-only, all DB-derived. Term-to-
// permanent is EDUCATIONAL outreach only — detect an approaching conversion window
// and invite to a review; never steer a product (guardrail §2.2). Securities-flagged
// policies are surfaced (firewall §2.1) but EXCLUDED from every automation figure.
// Added-premium is an assumption-based estimate (§2.3).

import { load, loadAll } from '@/lib/data/query'
import { estPremium } from './assumptions'

export type UrgencyTier = '30' | '90' | '180' | '365' | 'beyond'

export interface ConversionDue {
  policy_id: string
  household_id: string | null
  primary_name: string | null
  carrier_id: string | null
  product_id: string | null
  policy_number: string | null
  conversion_deadline: string | null
  is_security: boolean
  days_remaining: number | null
  urgency_tier: UrgencyTier
}

interface Activity {
  id: string
  entity_id: string | null
  kind: string | null
  note: string | null
  created_at: string
}

interface ReviewRow {
  id: string
  household_id: string | null
  stage: string | null
  scheduled_at: string | null
}

export interface ConversionsDashboard {
  rows: ConversionDue[] // automatable (non-security) eligible rows, non-'beyond'
  securityCount: number
  activities: Activity[]
  householdName: Map<string, string>
  agencyNameByHousehold: Map<string, string>
  kpis: {
    eligible: number
    urgent30: number
    within90: number
    contacted: number
    educated: number
    reviewsScheduled: number
    converted: number
    conversionRate: number
    estAddedPremium: number
    securityCount: number
  }
  tierDistribution: { tier: UrgencyTier; label: string; value: number }[]
  agencyLeaderboard: { name: string; opportunities: number }[]
  heat: { agencies: string[]; tiers: string[]; cells: number[][] }
}

const PREFIX = 'conversion_'
const TIER_LABELS: Record<UrgencyTier, string> = { '30': '≤ 30 days', '90': '31–90 days', '180': '91–180 days', '365': '181–365 days', beyond: 'Beyond 1 year' }

export async function loadConversionsDashboard(): Promise<
  { ok: true; data: ConversionsDashboard } | { ok: false; kind: 'not_configured' | 'error'; message: string }
> {
  const [dueR, actsR, reviewsR, hhR, agenciesR] = await Promise.all([
    load<ConversionDue[]>((db) => db.from('v_conversions_due').select('*').limit(5000), []),
    load<Activity[]>(
      (db) =>
        db
          .from('activities')
          .select('id, entity_id, kind, note, created_at')
          .eq('entity_type', 'policy')
          .like('kind', `${PREFIX}%`)
          .order('created_at', { ascending: false })
          .limit(3000),
      [],
    ),
    load<ReviewRow[]>(
      (db) =>
        db
          .from('reviews')
          .select('id, household_id, stage, scheduled_at')
          .eq('type', 'term_conversion')
          .is('deleted_at', null)
          .limit(2000),
      [],
    ),
    loadAll<{ id: string; referring_agency_id: string | null; primary_name: string | null }>(
      (db) => db.from('households').select('id, referring_agency_id, primary_name').is('deleted_at', null),
    ),
    load<{ id: string; agency_name: string | null }[]>(
      (db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).limit(2000),
      [],
    ),
  ])

  if (!dueR.ok) return { ok: false, kind: dueR.kind, message: dueR.message }

  const all = dueR.data
  const activities = actsR.ok ? actsR.data : []
  const reviews = reviewsR.ok ? reviewsR.data : []
  const households = hhR.ok ? hhR.data : []
  const agencies = agenciesR.ok ? agenciesR.data : []

  const agencyName = new Map<string, string>()
  for (const a of agencies) if (a.id && a.agency_name) agencyName.set(a.id, a.agency_name)
  const householdName = new Map<string, string>()
  const householdAgency = new Map<string, string>() // household_id → agency_id
  for (const h of households) {
    if (h.primary_name) householdName.set(h.id, h.primary_name)
    if (h.referring_agency_id) householdAgency.set(h.id, h.referring_agency_id)
  }
  const agencyNameByHousehold = new Map<string, string>()
  for (const [hid, aid] of householdAgency) {
    const name = agencyName.get(aid)
    if (name) agencyNameByHousehold.set(hid, name)
  }

  // Securities firewall: automation surfaces exclude is_security; we still count them.
  const securityCount = all.filter((r) => r.is_security).length
  const automatable = all.filter((r) => !r.is_security)
  const eligibleRows = automatable.filter((r) => r.urgency_tier !== 'beyond')

  const tierCount = (t: UrgencyTier) => eligibleRows.filter((r) => r.urgency_tier === t).length
  const urgent30 = tierCount('30')
  const within90 = urgent30 + tierCount('90')

  const action = (a: Activity) => (a.kind ? a.kind.slice(PREFIX.length) : '')
  const contacted = new Set(activities.map((a) => a.entity_id).filter(Boolean) as string[]).size
  const educated = new Set(
    activities.filter((a) => ['educate', 'invite'].includes(action(a))).map((a) => a.entity_id).filter(Boolean) as string[],
  ).size
  const reviewsScheduled = reviews.length
  const converted = reviews.filter((r) => ['completed', 'outcome_logged'].includes(r.stage ?? '')).length
  const eligible = eligibleRows.length
  const conversionRate = eligible > 0 ? Math.round((reviewsScheduled / eligible) * 100) : 0

  const tierDistribution = (['30', '90', '180', '365'] as UrgencyTier[]).map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    value: tierCount(tier),
  }))

  // Agency leaderboard + heat map from the household→agency join.
  const agencyOpps = new Map<string, number>()
  const agencyTier = new Map<string, Record<string, number>>()
  for (const r of eligibleRows) {
    const name = r.household_id ? agencyNameByHousehold.get(r.household_id) : undefined
    const key = name ?? 'Unlinked agency'
    agencyOpps.set(key, (agencyOpps.get(key) ?? 0) + 1)
    const t = agencyTier.get(key) ?? { '30': 0, '90': 0, '180': 0, '365': 0 }
    t[r.urgency_tier] = (t[r.urgency_tier] ?? 0) + 1
    agencyTier.set(key, t)
  }
  const agencyLeaderboard = [...agencyOpps.entries()]
    .map(([name, opportunities]) => ({ name, opportunities }))
    .sort((a, b) => b.opportunities - a.opportunities)
    .slice(0, 8)

  const heatAgencies = agencyLeaderboard.slice(0, 6).map((a) => a.name)
  const heatTiers = ['30', '90', '180', '365']
  const heatTierLabels = ['≤30d', '≤90d', '≤180d', '≤365d']
  const cells = heatAgencies.map((name) => {
    const t = agencyTier.get(name) ?? {}
    return heatTiers.map((tier) => t[tier] ?? 0)
  })

  return {
    ok: true,
    data: {
      rows: eligibleRows,
      securityCount,
      activities,
      householdName,
      agencyNameByHousehold,
      kpis: {
        eligible,
        urgent30,
        within90,
        contacted,
        educated,
        reviewsScheduled,
        converted,
        conversionRate,
        estAddedPremium: estPremium(converted || reviewsScheduled),
        securityCount,
      },
      tierDistribution,
      agencyLeaderboard,
      heat: { agencies: heatAgencies, tiers: heatTierLabels, cells },
    },
  }
}
