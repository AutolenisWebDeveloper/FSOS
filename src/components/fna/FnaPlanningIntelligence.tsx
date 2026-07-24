import Link from 'next/link'
import { Section, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { computePlanningSignals } from '@/lib/fna/intelligence'

// Planning intelligence surfaced onto the EXISTING dashboards (build instruction
// §10 — no new dashboard). Self-contained + degrading: it loads its own signals
// and renders nothing if the DB is unconfigured or there are no plans, so it is
// safe to drop into any dashboard. Every tile links back into the command center.
export async function FnaPlanningIntelligence() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const [plansRes, versionsRes, dqRes, recsRes, reviewsRes, policiesRes] = await Promise.all([
    load<Array<{ id: string; status: string; current_version_id: string | null }>>(
      (db) => db.from('fna_plans').select('id, status, current_version_id').is('deleted_at', null).limit(500),
      [],
    ),
    load<Array<{ id: string; inputs_snapshot: { completeness?: number } | null }>>(
      (db) => db.from('fna_versions').select('id, inputs_snapshot').limit(500),
      [],
    ),
    load<Array<{ id: string }>>((db) => db.from('fna_data_quality_exceptions').select('id').eq('resolved', false).limit(1000), []),
    load<Array<{ id: string }>>((db) => db.from('fna_recommendations').select('id').eq('status', 'DRAFT').limit(1000), []),
    load<Array<{ id: string }>>((db) => db.from('reviews').select('id').gte('scheduled_at', today).lte('scheduled_at', in90).limit(1000), []),
    load<Array<{ id: string; conversion_deadline: string | null; renewal_date: string | null }>>(
      (db) => db.from('household_policies').select('id, conversion_deadline, renewal_date').is('deleted_at', null).limit(2000),
      [],
    ),
  ])

  // If we can't read plans (unconfigured) or there are none, render nothing.
  if (!plansRes.ok || plansRes.data.length === 0) return null

  const completenessByVersion = new Map<string, number>()
  for (const v of versionsRes.ok ? versionsRes.data : []) {
    if (typeof v.inputs_snapshot?.completeness === 'number') completenessByVersion.set(v.id, v.inputs_snapshot.completeness)
  }

  const policyMilestones = (policiesRes.ok ? policiesRes.data : []).filter((p) => {
    const c = p.conversion_deadline?.slice(0, 10)
    const r = p.renewal_date?.slice(0, 10)
    return (c && c >= today && c <= in90) || (r && r >= today && r <= in90)
  }).length

  const signals = computePlanningSignals({
    plans: plansRes.data.map((p) => ({ status: p.status, completeness: p.current_version_id ? completenessByVersion.get(p.current_version_id) ?? null : null })),
    openDataQuality: dqRes.ok ? dqRes.data.length : 0,
    draftRecommendations: recsRes.ok ? recsRes.data.length : 0,
    reviewsDue: reviewsRes.ok ? reviewsRes.data.length : 0,
    policyMilestones,
  })

  return (
    <Section
      title="Planning intelligence"
      description="Derived from the AI FNA Command Center."
      action={<Link className="text-sm text-primary hover:underline" href="/app/fna">Open command center</Link>}
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Plans" value={signals.plansTotal} href="/app/fna/plans" hint={`${signals.approved} approved`} />
        <StatTile label="Needs attention" value={signals.needsAttention} href="/app/fna/reports" tone={signals.needsAttention > 0 ? 'attention' : 'neutral'} hint="Calculated, not approved" />
        <StatTile label="Planning confidence" value={`${Math.round(signals.planningConfidence * 100)}%`} href="/app/fna" hint="Avg input completeness" tone="brand" />
        <StatTile label="Data quality" value={signals.openDataQuality} href="/app/fna/documents" tone={signals.openDataQuality > 0 ? 'attention' : 'neutral'} hint="Open exceptions" />
        <StatTile label="Advisor actions" value={signals.openAdvisorActions} href="/app/fna/recommendations" tone={signals.openAdvisorActions > 0 ? 'attention' : 'neutral'} hint="Draft recommendations" />
        <StatTile label="Milestones (90d)" value={signals.upcomingMilestones} href="/app/fna/timeline" hint={`${signals.reviewsDue} reviews due`} />
      </div>
    </Section>
  )
}
