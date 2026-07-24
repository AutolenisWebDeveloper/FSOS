import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { RecommendationWorkspace } from '@/components/fna/RecommendationWorkspace'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlanRow {
  id: string
  household_id: string
  current_version_id: string | null
  title: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
}
interface RecRow {
  id: string
  status: string
  objective: string
  product_category: string | null
  authored_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  fna_plans: { title: string | null; households: { primary_name: string } | { primary_name: string }[] | null } | { title: string | null; households: { primary_name: string } | { primary_name: string }[] | null }[] | null
}

function hhName(h: { primary_name: string } | { primary_name: string }[] | null | undefined): string {
  const v = Array.isArray(h) ? h[0] : h
  return v?.primary_name ?? 'Household'
}

// Advisor workspace — recommendations (build instruction §1, §8). Author and
// approve HUMAN recommendations with the Reg-BI governance capture; the system
// never generates one. Roles: fsa, licensed_staff.
export default async function FnaRecommendationsPage() {
  await requireRole('fsa', '/app/fna/recommendations')

  const [plansRes, recsRes] = await Promise.all([
    load<PlanRow[]>(
      (db) => db.from('fna_plans').select('id, household_id, current_version_id, title, households(primary_name)').is('deleted_at', null).order('updated_at', { ascending: false }).limit(200),
      [],
    ),
    load<RecRow[]>(
      (db) => db.from('fna_recommendations').select('id, status, objective, product_category, authored_by, approved_by, approved_at, created_at, fna_plans(title, households(primary_name))').order('created_at', { ascending: false }).limit(100),
      [],
    ),
  ])

  const header = (
    <PageHeader
      title="Recommendations"
      description="Author and approve recommendations with the full Reg BI governance record. FSOS analyzes; you recommend."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Recommendations' }]}
    />
  )

  if (!plansRes.ok) {
    return (
      <div className="space-y-6">
        {header}
        {plansRes.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={plansRes.message} />}
      </div>
    )
  }

  const plans = plansRes.data.map((p) => ({ id: p.id, household_id: p.household_id, current_version_id: p.current_version_id, name: p.title || hhName(p.households) }))
  const recommendations = (recsRes.ok ? recsRes.data : []).map((r) => {
    const plan = Array.isArray(r.fna_plans) ? r.fna_plans[0] : r.fna_plans
    return {
      id: r.id,
      status: r.status,
      objective: r.objective,
      product_category: r.product_category,
      authored_by: r.authored_by,
      approved_by: r.approved_by,
      approved_at: r.approved_at,
      created_at: r.created_at,
      planName: plan?.title || hhName(plan?.households),
    }
  })

  return (
    <div className="space-y-6">
      {header}
      {plans.length === 0 ? (
        <EmptyState title="No plans yet" description="Create a plan first — a recommendation attaches to a plan and its version." />
      ) : (
        <RecommendationWorkspace plans={plans} recommendations={recommendations} />
      )}
    </div>
  )
}
