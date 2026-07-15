import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { SecuritiesChip, SecuritiesBanner } from '@/components/ui/securities'
import { Numeric, Money } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { LogActivityButton } from '@/components/app/LogActivityButton'
import { OpportunityStageControl } from '@/components/app/OpportunityStageControl'

export const dynamic = 'force-dynamic'

interface Opp {
  id: string
  household_id: string | null
  referral_id: string | null
  referring_agency_id: string | null
  product_id: string | null
  engagement: string
  stage: string
  is_security: boolean
  ffs_case_ref: string | null
  license_basis_used: string | null
  premium: number | null
  aum: number | null
  expected_commission: number | null
  lost_reason: string | null
  stage_history: { stage: string; at: string; actor?: string; note?: string | null }[]
}

// OS-09 Opportunity Detail (A3).
export default async function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Opp | null>(
    (db) => db.from('opportunities').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const o = res.data
  if (!o) notFound()

  const [hh, product, commission] = await Promise.all([
    o.household_id ? load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', o.household_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
    o.product_id ? load<{ family: string; subtype: string | null } | null>((db) => db.from('products').select('family, subtype').eq('id', o.product_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
    load<{ id: string }[]>((db) => db.from('commissions').select('id').eq('opportunity_id', params.id).limit(1), []),
  ])
  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const commissionId = commission.ok && commission.data[0] ? commission.data[0].id : null
  const history = Array.isArray(o.stage_history) ? o.stage_history : []

  return (
    <DetailShell
      title={householdName ? `Opportunity — ${householdName}` : 'Opportunity'}
      description={`${o.engagement}${product.ok && product.data ? ` · ${product.data.family}` : ''}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Opportunities', href: '/app/opportunities' }, { label: householdName ?? 'Opportunity' }]}
      status={
        <span className="flex items-center gap-2">
          <StatusBadge status={o.stage === 'placed_issued' ? 'won' : o.stage === 'lost' ? 'lost' : 'active'} label={o.stage.replace(/_/g, ' ')} />
          {o.is_security ? <SecuritiesChip /> : null}
        </span>
      }
      actions={<LogActivityButton entityType="opportunity" entityId={params.id} />}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            {o.household_id ? <li><Link href={`/app/households/${o.household_id}`} className="text-primary hover:underline">Household</Link></li> : null}
            {o.referral_id ? <li><Link href={`/app/referrals/${o.referral_id}`} className="text-primary hover:underline">Source referral</Link></li> : null}
            {o.referring_agency_id ? <li><Link href={`/app/agencies/${o.referring_agency_id}`} className="text-primary hover:underline">Attributed agency</Link></li> : null}
            {commissionId ? <li><Link href="/app/commissions" className="text-primary hover:underline">Commission record</Link></li> : null}
            <li><Link href="/app/opportunities/board" className="text-primary hover:underline">Pipeline board</Link></li>
          </ul>
        </div>
      }
    >
      {o.is_security ? (
        <div className="space-y-1.5">
          <SecuritiesBanner />
          <p className="pl-1 text-xs text-status-security">
            FFS case ref:{' '}
            <Numeric>{o.ffs_case_ref ?? 'no FFS ref set'}</Numeric> — suitability &amp; Reg BI happen in
            FFS; no automated client contact.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Stage</CardTitle>
          <OpportunityStageControl id={params.id} stage={o.stage} />
        </CardHeader>
        <CardContent>
          <ol className="space-y-1 text-sm">
            {history.length === 0 ? <li className="text-muted-foreground">No stage history.</li> : history.map((h, i) => (
              <li key={i} className="flex gap-2">
                <Numeric className="text-muted-foreground">{new Date(h.at).toLocaleString('en-US')}</Numeric>
                <span className="font-medium capitalize">{h.stage.replace(/_/g, ' ')}</span>
                {h.note ? <span className="text-muted-foreground">— {h.note}</span> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Attribution</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Household" value={householdName ?? '—'} />
            <Row label="Engagement" value={o.engagement} />
            <Row label="Product" value={product.ok && product.data ? `${product.data.family}${product.data.subtype ? ` · ${product.data.subtype}` : ''}` : 'Undetermined'} />
            <Row label="License basis" value={o.license_basis_used ?? '—'} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Value</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Expected premium" value={<Money value={o.premium} />} />
            <Row label="Expected AUM" value={<Money value={o.aum} />} />
            <Row label="Expected commission" value={<Money value={o.expected_commission} />} />
            {o.lost_reason ? <Row label="Lost reason" value={o.lost_reason} /> : null}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
