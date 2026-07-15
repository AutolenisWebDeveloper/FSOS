import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { OutreachActions } from '@/components/app/OutreachActions'

export const dynamic = 'force-dynamic'

interface Policy {
  id: string
  household_id: string
  policy_number: string | null
  status: string
  conversion_deadline: string | null
  is_security: boolean
  premium: number | null
}

// OS-07 Conversion Opportunity Detail (A3). The only client-facing content permitted
// is neutral education + a review invitation — never a specific product.
export default async function ConversionDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Policy | null>((db) => db.from('household_policies').select('id, household_id, policy_number, status, conversion_deadline, is_security, premium').eq('id', params.id).is('deleted_at', null).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const p = res.data
  if (!p) notFound()

  const [hh, activities] = await Promise.all([
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', p.household_id).maybeSingle(), null),
    load<{ id: string; kind: string | null; note: string | null; created_at: string }[]>((db) => db.from('activities').select('id, kind, note, created_at').eq('entity_type', 'policy').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(20), []),
  ])
  const householdName = hh.ok ? hh.data?.primary_name ?? null : null

  return (
    <DetailShell
      title={`Conversion — ${householdName ?? 'household'}`}
      description="Educational conversion review invitation. No product steering."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Term Conversion', href: '/app/conversions' }, { label: householdName ?? 'Policy' }]}
      status={<span className="flex items-center gap-2">{p.is_security ? <Badge variant="blocked">securities · excluded</Badge> : <Badge variant="active">eligible</Badge>}<AssumptionBadge /></span>}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/households/${p.household_id}`} className="text-primary hover:underline">Household</Link></li>
            <li><Link href={`/app/policies/${p.id}`} className="text-primary hover:underline">Policy record</Link></li>
            <li><Link href={`/app/reviews/new?household=${p.household_id}&type=term_conversion`} className="text-primary hover:underline">Schedule review</Link></li>
          </ul>
        </div>
      }
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Green-zone actions</CardTitle></CardHeader>
        <CardContent>
          <OutreachActions endpoint={`/api/conversions/${p.id}`} isSecurity={p.is_security} />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Policy</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Number</span><span>{p.policy_number ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="capitalize">{p.status}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Conversion deadline</span><span>{p.conversion_deadline ?? '—'}</span></div>
            <p className="pt-2 text-xs text-muted-foreground">Window is a config default — verify against the FNWL contract.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Outreach log</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {activities.ok && activities.data.length > 0 ? activities.data.map((a) => (
              <div key={a.id} className="border-b py-1 last:border-0">
                <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-US')}</span>
                <p className="capitalize">{(a.kind ?? '').replace(/_/g, ' ')} — {a.note}</p>
              </div>
            )) : <p className="text-muted-foreground">No outreach logged yet.</p>}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}
