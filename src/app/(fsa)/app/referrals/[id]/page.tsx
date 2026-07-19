import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Numeric } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { ReferralActions } from '@/components/app/ReferralActions'
import { LogActivityButton } from '@/components/app/LogActivityButton'

export const dynamic = 'force-dynamic'

interface Referral {
  id: string
  referred_name: string | null
  engagement: string
  status: string
  received_at: string
  first_touch_at: string | null
  sla_due_at: string | null
  referring_agency_id: string | null
  household_id: string | null
  loss_reason: string | null
}

// OS-03 Referral Detail (A3).
export default async function ReferralDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Referral | null>(
    (db) => db.from('referrals').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const r = res.data
  if (!r) notFound()

  const [agency, activities, consentIntent] = await Promise.all([
    r.referring_agency_id
      ? load<{ agency_name: string } | null>((db) => db.from('agency_partnerships').select('agency_name').eq('id', r.referring_agency_id).maybeSingle(), null)
      : Promise.resolve({ ok: true as const, data: null }),
    load<{ id: string; kind: string; note: string; created_at: string }[]>(
      (db) => db.from('activities').select('id, kind, note, created_at').eq('entity_type', 'referral').eq('entity_id', params.id).order('created_at', { ascending: false }),
      [],
    ),
    load<{ note: string }[]>(
      (db) => db.from('activities').select('note').eq('entity_type', 'referral').eq('entity_id', params.id).eq('kind', 'consent_intent').limit(1),
      [],
    ),
  ])

  const agencyName = agency.ok ? agency.data?.agency_name ?? null : null
  const canConvert = Boolean(r.referred_name && r.status !== 'converted' && r.status !== 'declined')
  const consentNote = consentIntent.ok && consentIntent.data[0] ? consentIntent.data[0].note : null

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Related</p>
      <ul className="space-y-1.5">
        {r.referring_agency_id ? (
          <li><Link href={`/app/agencies/${r.referring_agency_id}`} className="text-primary hover:underline">Referring agency</Link></li>
        ) : null}
        {r.household_id ? (
          <li><Link href={`/app/households/${r.household_id}`} className="text-primary hover:underline">Matched household</Link></li>
        ) : null}
        {r.status === 'converted' ? (
          <li><Link href="/app/opportunities" className="text-primary hover:underline">Resulting opportunity</Link></li>
        ) : null}
      </ul>
    </div>
  )

  return (
    <DetailShell
      title={r.referred_name ?? 'Unnamed referral'}
      description={`${r.engagement} · received ${new Date(r.received_at).toLocaleDateString('en-US')}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Referrals', href: '/app/referrals' }, { label: r.referred_name ?? 'Referral' }]}
      status={<StatusBadge status={r.status === 'converted' ? 'won' : r.status === 'declined' ? 'lost' : 'active'} label={r.status} />}
      actions={
        <>
          <LogActivityButton entityType="referral" entityId={params.id} />
          <ReferralActions id={params.id} status={r.status} canConvert={canConvert} />
        </>
      }
      rail={rail}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Referral</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Referring agency" value={agencyName ?? 'Direct / none'} />
            <Row label="Engagement" value={r.engagement} />
            <Row label="First touch" value={r.first_touch_at ? <Numeric>{new Date(r.first_touch_at).toLocaleString('en-US')}</Numeric> : 'Not yet — SLA running'} />
            <Row label="SLA due" value={r.sla_due_at ? <Numeric>{new Date(r.sla_due_at).toLocaleString('en-US')}</Numeric> : '—'} />
            {r.loss_reason ? <Row label="Loss reason" value={r.loss_reason.replace(/_/g, ' ')} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Consent</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {consentNote ? (
              <Badge variant="won">{consentNote}</Badge>
            ) : (
              <p className="text-muted-foreground">No consent captured at intake. Automated contact is blocked by the comms gate until valid consent is on file.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Activity</CardTitle></CardHeader>
        <CardContent>
          {!activities.ok || activities.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="space-y-2">
              {activities.data.map((a) => (
                <li key={a.id} className="flex gap-2 text-sm">
                  <Numeric className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString('en-US')}</Numeric>
                  <span className="font-medium capitalize">{a.kind.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground">— {a.note}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </DetailShell>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
