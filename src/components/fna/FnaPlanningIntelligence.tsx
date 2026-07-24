import Link from 'next/link'
import { Section, StatTile } from '@/components/archetypes'
import { load, loadCount } from '@/lib/data/query'
import { computePlanningSignals } from '@/lib/fna/intelligence'

// Planning intelligence surfaced onto the EXISTING dashboards (build instruction
// §10 — no new dashboard). Self-contained + degrading: it loads its own signals
// and renders nothing if the DB is unconfigured or there are no plans, so it is
// safe to drop into any dashboard. Every tile links back into the command center.
export async function FnaPlanningIntelligence() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Plans first — the widget renders nothing without them, and they tell us exactly
  // which version rows we need (so we don't pull every version's full JSONB snapshot).
  const plansRes = await load<Array<{ id: string; status: string; current_version_id: string | null }>>(
    (db) => db.from('fna_plans').select('id, status, current_version_id').is('deleted_at', null).limit(500),
    [],
  )
  if (!plansRes.ok || plansRes.data.length === 0) return null

  const currentVersionIds = plansRes.data.map((p) => p.current_version_id).filter((v): v is string => !!v)

  const [versionsRes, openDataQuality, draftRecommendations, reviewsDue, policyMilestones] = await Promise.all([
    // Only the versions the plans actually point at, not all 500 (P3: scoped fetch).
    currentVersionIds.length > 0
      ? load<Array<{ id: string; inputs_snapshot: { completeness?: number } | null }>>(
          (db) => db.from('fna_versions').select('id, inputs_snapshot').in('id', currentVersionIds),
          [],
        )
      : Promise.resolve({ ok: true as const, data: [] as Array<{ id: string; inputs_snapshot: { completeness?: number } | null }> }),
    // Counts as head-only counts — no rows transferred just to take .length.
    loadCount((db) => db.from('fna_data_quality_exceptions').select('id', { count: 'exact', head: true }).eq('resolved', false)),
    loadCount((db) => db.from('fna_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'DRAFT')),
    loadCount((db) => db.from('reviews').select('id', { count: 'exact', head: true }).gte('scheduled_at', today).lte('scheduled_at', in90)),
    // Push the 90-day milestone filter into SQL (conversion OR renewal in window) and
    // count only — instead of pulling up to 2000 policy rows and filtering in JS.
    loadCount((db) =>
      db
        .from('household_policies')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .or(`and(conversion_deadline.gte.${today},conversion_deadline.lte.${in90}),and(renewal_date.gte.${today},renewal_date.lte.${in90})`),
    ),
  ])

  const completenessByVersion = new Map<string, number>()
  for (const v of versionsRes.ok ? versionsRes.data : []) {
    if (typeof v.inputs_snapshot?.completeness === 'number') completenessByVersion.set(v.id, v.inputs_snapshot.completeness)
  }

  const signals = computePlanningSignals({
    plans: plansRes.data.map((p) => ({ status: p.status, completeness: p.current_version_id ? completenessByVersion.get(p.current_version_id) ?? null : null })),
    openDataQuality,
    draftRecommendations,
    reviewsDue,
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
