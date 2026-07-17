import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { CaseRequirements, type Requirement } from '@/components/app/CaseControls'

export const dynamic = 'force-dynamic'

// OS-10 Submission Checklist (A3). Completeness is INFORMATIONAL readiness — NOT a
// NIGO/defect score. Carrier rules are config, assumption-flagged where Farmers-specific.
export default async function CaseChecklistPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<{ id: string; household_id: string | null; carrier_id: string | null } | null>((db) => db.from('cases').select('id, household_id, carrier_id').eq('id', params.id).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  const reqs = await load<Requirement[]>((db) => db.from('case_requirements').select('id, requirement, status, source').eq('case_id', params.id).order('created_at'), [])
  const requirements = reqs.ok ? reqs.data : []
  const complete = requirements.filter((r) => r.status !== 'outstanding').length

  return (
    <DetailShell
      title="Submission Checklist"
      description="Readiness view — informational, not a defect score."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases', href: '/app/cases' }, { label: 'Case', href: `/app/cases/${c.id}` }, { label: 'Checklist' }]}
      status={<AssumptionBadge label="carrier rules — config, verify" />}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Readiness: {complete}/{requirements.length || 0} items</CardTitle></CardHeader>
        <CardContent>
          <CaseRequirements caseId={c.id} requirements={requirements} />
          <p className="mt-3 text-xs text-muted-foreground">Required items per product/carrier are config-driven. Carrier rules are labeled config defaults — verify; never invented.</p>
        </CardContent>
      </Card>
      <p className="text-sm"><Link href={`/app/cases/${c.id}`} className="text-primary hover:underline">Back to case</Link></p>
    </DetailShell>
  )
}
