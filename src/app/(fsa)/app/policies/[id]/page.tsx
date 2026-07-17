import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Numeric, Money } from '@/components/ui/typography'
import { SecuritiesChip, SecuritiesBanner } from '@/components/ui/securities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface Policy {
  id: string
  policy_number: string | null
  household_id: string
  carrier_id: string | null
  product_id: string | null
  status: string
  is_with_us: boolean
  is_security: boolean
  ffs_case_ref: string | null
  premium: number | null
  effective_date: string | null
  renewal_date: string | null
  x_date: string | null
  conversion_deadline: string | null
  archived_at: string | null
}

// OS-05 Policy Detail (A3). is_security → firewall banner + no automated send.
export default async function PolicyDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Policy | null>(
    (db) => db.from('household_policies').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const p = res.data
  if (!p) notFound()

  const [hh, carrier, product] = await Promise.all([
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', p.household_id).maybeSingle(), null),
    p.carrier_id ? load<{ name: string } | null>((db) => db.from('carriers').select('name').eq('id', p.carrier_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
    p.product_id ? load<{ family: string; subtype: string | null } | null>((db) => db.from('products').select('family, subtype').eq('id', p.product_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
  ])
  const householdName = hh.ok ? hh.data?.primary_name ?? 'Household' : 'Household'

  return (
    <DetailShell
      title={p.policy_number ?? 'Unnumbered policy'}
      description={`${p.is_with_us ? 'Own book' : 'Competitor'} · ${householdName}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Policies', href: '/app/policies' }, { label: p.policy_number ?? 'Policy' }]}
      status={
        <span className="flex items-center gap-2">
          <StatusBadge status={p.status === 'active' ? 'won' : p.status === 'lapsed' || p.status === 'cancelled' ? 'lost' : 'active'} label={p.status} />
          {p.is_security ? <SecuritiesChip /> : null}
          {p.archived_at ? <Badge variant="draft">archived</Badge> : null}
        </span>
      }
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/households/${p.household_id}`} className="text-primary hover:underline">Household</Link></li>
            <li><Link href={`/app/opportunities?household=${p.household_id}`} className="text-primary hover:underline">Opportunities</Link></li>
            {p.conversion_deadline ? <li><Link href="/app/policies?conversion=1" className="text-primary hover:underline">Term-conversion pipeline</Link></li> : null}
          </ul>
        </div>
      }
    >
      {p.is_security ? (
        <div className="space-y-1.5">
          <SecuritiesBanner />
          {p.ffs_case_ref ? (
            <p className="text-xs text-status-security">Reference: <Numeric>{p.ffs_case_ref}</Numeric></p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Coverage</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Carrier" value={carrier.ok ? carrier.data?.name ?? '—' : '—'} />
            <Row label="Product" value={product.ok && product.data ? `${product.data.family}${product.data.subtype ? ` · ${product.data.subtype}` : ''}` : '—'} />
            <Row label="Premium" value={<Money value={p.premium} />} />
            <Row label="Effective" value={<Numeric>{fmt(p.effective_date)}</Numeric>} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Dates &amp; status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.is_with_us ? (
              <>
                <Row label="Renewal date" value={<Numeric>{fmt(p.renewal_date)}</Numeric>} />
                <Row label="Conversion deadline" value={<Numeric>{fmt(p.conversion_deadline)}</Numeric>} />
              </>
            ) : (
              <Row label="Competitor X-date" value={<Numeric>{fmt(p.x_date)}</Numeric>} />
            )}
            <Row label="In force" value={p.status === 'active' ? 'Yes' : 'No'} />
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}

function fmt(s: string | null) {
  return s ? new Date(s).toLocaleDateString('en-US') : '—'
}
function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
