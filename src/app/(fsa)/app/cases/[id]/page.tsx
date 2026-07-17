import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, SecuritiesBanner } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { CaseStatusControl, CaseRequirements, type Requirement } from '@/components/app/CaseControls'

export const dynamic = 'force-dynamic'

interface Case {
  id: string
  opportunity_id: string
  household_id: string | null
  carrier_id: string | null
  status: string
  is_security: boolean
  ffs_case_ref: string | null
  submitted_at: string | null
  issued_at: string | null
  replacement_flag: boolean
}

// OS-10 Case Detail (A3). No NIGO artifacts.
export default async function CaseDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Case | null>((db) => db.from('cases').select('*').eq('id', params.id).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  const [hh, reqs, commission, services] = await Promise.all([
    c.household_id ? load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', c.household_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
    load<Requirement[]>((db) => db.from('case_requirements').select('id, requirement, status, source').eq('case_id', params.id).order('created_at'), []),
    load<{ id: string }[]>((db) => db.from('commissions').select('id').eq('opportunity_id', c.opportunity_id).limit(1), []),
    load<{ id: string; kind: string; status: string }[]>((db) => db.from('case_service_requests').select('id, kind, status').eq('case_id', params.id).order('created_at', { ascending: false }), []),
  ])
  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const requirements = reqs.ok ? reqs.data : []
  const commissionId = commission.ok && commission.data[0] ? commission.data[0].id : null

  return (
    <DetailShell
      title={householdName ? `Case — ${householdName}` : 'Case'}
      description={c.submitted_at ? `Submitted ${new Date(c.submitted_at).toLocaleDateString('en-US')}` : 'Draft'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases', href: '/app/cases' }, { label: householdName ?? 'Case' }]}
      status={<span className="flex items-center gap-2"><StatusBadge status={c.status === 'issued' || c.status === 'in_service' ? 'won' : c.status === 'declined' || c.status === 'withdrawn' ? 'lost' : 'active'} label={c.status.replace(/_/g, ' ')} />{c.is_security ? <SecuritiesChip /> : null}{c.replacement_flag ? <Badge variant="blocked">replacement</Badge> : null}</span>}
      actions={<Button asChild variant="outline"><Link href={`/app/cases/${c.id}/checklist`}>Checklist</Link></Button>}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/opportunities/${c.opportunity_id}`} className="text-primary hover:underline">Opportunity</Link></li>
            {c.household_id ? <li><Link href={`/app/households/${c.household_id}`} className="text-primary hover:underline">Household</Link></li> : null}
            {commissionId ? <li><Link href={`/app/commissions/${commissionId}`} className="text-primary hover:underline">Commission</Link></li> : null}
            <li><Link href={`/app/cases/${c.id}/checklist`} className="text-primary hover:underline">Submission checklist</Link></li>
          </ul>
        </div>
      }
    >
      {c.is_security ? (
        <div className="space-y-1.5">
          <SecuritiesBanner />
          <p className="pl-1 text-xs text-status-security">
            FFS case ref: <Numeric>{c.ffs_case_ref ?? 'no FFS ref'}</Numeric> — suitability &amp; underwriting are
            supervised in FFS; no suitability determination is stored.
          </p>
        </div>
      ) : null}
      <Card>
        <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Status</CardTitle><CaseStatusControl id={c.id} status={c.status} /></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Issue prompts the commission record from split defaults. Requirements-outstanding is a readiness state, not a defect score.</p></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Carrier requirements</CardTitle></CardHeader>
        <CardContent><CaseRequirements caseId={c.id} requirements={requirements} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Service requests</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {services.ok && services.data.length > 0 ? (
            <ul className="space-y-1">{services.data.map((s) => (<li key={s.id} className="flex justify-between"><span className="capitalize">{s.kind}</span><Badge variant="outline">{s.status}</Badge></li>))}</ul>
          ) : <p className="text-muted-foreground">No service requests. These are post-issue policy-service items.</p>}
        </CardContent>
      </Card>
    </DetailShell>
  );
}
