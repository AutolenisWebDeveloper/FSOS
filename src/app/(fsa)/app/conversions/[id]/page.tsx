import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { OutreachActions } from '@/components/app/OutreachActions'
import { Numeric, Money } from '@/components/ui/typography'
import { SecuritiesChip } from '@/components/ui/securities'

export const dynamic = 'force-dynamic'

// The conversion detail block stashed on household_policies.source_data by the
// Life Conversion importer — every column of the District export lives here, so
// the feature surfaces the full record (not just number + deadline).
interface ConversionDetail {
  convertible_amount?: number | null
  product_type?: string | null
  insured?: string | null
  insured_dob?: string | null
  inception_date?: string | null
  expiration_date?: string | null
  conversion_deadline?: string | null
  preferred_email?: string | null
  preferred_phone?: string | null
  agent_of_record?: string | null
  aor_code?: string | null
}

interface Policy {
  id: string
  household_id: string
  policy_number: string | null
  status: string
  conversion_deadline: string | null
  is_security: boolean
  premium: number | null
  product_name: string | null
  face_amount: number | null
  effective_date: string | null
  expiration_date: string | null
  source_data: { conversion?: ConversionDetail } | null
}

// OS-07 Conversion Opportunity Detail (A3). The only client-facing content permitted
// is neutral education + a review invitation — never a specific product.
export default async function ConversionDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Policy | null>((db) => db.from('household_policies').select('id, household_id, policy_number, status, conversion_deadline, is_security, premium, product_name, face_amount, effective_date, expiration_date, source_data').eq('id', params.id).is('deleted_at', null).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const p = res.data
  if (!p) notFound()

  const [hh, activities] = await Promise.all([
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', p.household_id).maybeSingle(), null),
    load<{ id: string; kind: string | null; note: string | null; created_at: string }[]>((db) => db.from('activities').select('id, kind, note, created_at').eq('entity_type', 'policy').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(20), []),
  ])
  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const conv: ConversionDetail = p.source_data?.conversion ?? {}

  return (
    <DetailShell
      title={`Conversion — ${householdName ?? 'household'}`}
      description="Educational conversion review invitation. No product steering."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Term Conversion', href: '/app/conversions' }, { label: householdName ?? 'Policy' }]}
      status={<span className="flex items-center gap-2">{p.is_security ? <SecuritiesChip /> : <Badge variant="active">eligible</Badge>}<AssumptionBadge /></span>}
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
            <Row label="Policy number"><Numeric>{p.policy_number ?? '—'}</Numeric></Row>
            <Row label="Policy holder">{householdName ?? '—'}</Row>
            <Row label="Primary insured">{conv.insured ?? householdName ?? '—'}</Row>
            <Row label="Product type">{p.product_name ?? conv.product_type ?? '—'}</Row>
            <Row label="Coverage amount"><Money value={p.face_amount ?? conv.convertible_amount ?? null} /></Row>
            <Row label="Status"><span className="capitalize">{p.status}</span></Row>
            <p className="pt-2 text-xs text-muted-foreground">Window is a config default — verify against the FNWL contract.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Conversion & dates</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Conversion expiring date"><Numeric>{p.conversion_deadline ?? conv.conversion_deadline ?? '—'}</Numeric></Row>
            <Row label="Inception date"><Numeric>{p.effective_date ?? conv.inception_date ?? '—'}</Numeric></Row>
            <Row label="Policy expiration date"><Numeric>{p.expiration_date ?? conv.expiration_date ?? '—'}</Numeric></Row>
            <Row label="Insured birthday"><Numeric>{conv.insured_dob ?? '—'}</Numeric></Row>
            <p className="pt-2 text-xs text-muted-foreground">Insured birthday is month/day only (no year in the source) — never fabricated.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Servicing & contact</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Agent of record">{conv.agent_of_record ?? '—'}</Row>
            <Row label="AOR code"><Numeric>{conv.aor_code ?? '—'}</Numeric></Row>
            <Row label="Preferred email">{conv.preferred_email ? <a href={`mailto:${conv.preferred_email}`} className="text-primary hover:underline">{conv.preferred_email}</a> : '—'}</Row>
            <Row label="Preferred phone">{conv.preferred_phone ? <a href={`tel:${conv.preferred_phone}`} className="text-primary hover:underline"><Numeric>{conv.preferred_phone}</Numeric></a> : '—'}</Row>
            <p className="pt-2 text-xs text-muted-foreground">Contact points are stored for reachability; the dispatcher still gates any outreach (consent, quiet hours, DNC).</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Outreach log</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {activities.ok && activities.data.length > 0 ? activities.data.map((a) => (
              <div key={a.id} className="border-b py-1 last:border-0">
                <Numeric className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString('en-US')}</Numeric>
                <p className="capitalize">{(a.kind ?? '').replace(/_/g, ' ')} — {a.note}</p>
              </div>
            )) : <p className="text-muted-foreground">No outreach logged yet.</p>}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  );
}

// One label/value line in a detail card.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
