import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge, StatusBadge } from '@/components/archetypes'
import { SecuritiesChip, SecuritiesBanner } from '@/components/ui/securities'
import { Money, Numeric } from '@/components/ui/typography'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { CommissionReconcileControls } from '@/components/app/CommissionControls'

export const dynamic = 'force-dynamic'

interface Commission {
  id: string
  opportunity_id: string | null
  referring_agency_id: string | null
  product_family: string | null
  is_security: boolean
  license_basis: string | null
  total_commission: number
  fsa_split_pct: number | null
  agency_split_pct: number | null
  fsa_amount: number
  agency_amount: number
  received_amount: number
  is_trail: boolean
  paid_on: string | null
  reconciliation_status: string
  ffs_case_ref: string | null
}

// OS-11 Commission Record Detail (A3).
export default async function CommissionDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<Commission | null>((db) => db.from('commissions').select('*').eq('id', params.id).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  const [agency, receipts, adjustments] = await Promise.all([
    c.referring_agency_id ? load<{ agency_name: string } | null>((db) => db.from('agency_partnerships').select('agency_name').eq('id', c.referring_agency_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
    load<{ id: string; amount: number; period: string | null; paid_on: string | null }[]>((db) => db.from('commission_receipts').select('id, amount, period, paid_on').eq('commission_id', params.id).order('created_at', { ascending: false }), []),
    load<{ id: string; amount: number; kind: string; reason: string }[]>((db) => db.from('commission_adjustments').select('id, amount, kind, reason').eq('commission_id', params.id).order('created_at', { ascending: false }), []),
  ])
  const agencyName = agency.ok ? agency.data?.agency_name ?? null : null

  return (
    <DetailShell
      title={`Commission — ${agencyName ?? 'Direct'}`}
      description={`${c.product_family ?? 'unclassified'}${c.is_trail ? ' · trail' : ''}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: agencyName ?? 'Record' }]}
      status={<span className="flex items-center gap-2"><StatusBadge status={c.reconciliation_status === 'matched' ? 'won' : c.reconciliation_status === 'discrepancy' ? 'lost' : 'pending'} label={c.reconciliation_status} />{c.is_security ? <SecuritiesChip /> : null}<AssumptionBadge /></span>}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            {c.opportunity_id ? <li><Link href={`/app/opportunities/${c.opportunity_id}`} className="text-primary hover:underline">Opportunity</Link></li> : null}
            {c.referring_agency_id ? <li><Link href={`/app/agencies/${c.referring_agency_id}`} className="text-primary hover:underline">Agency</Link></li> : null}
            <li><Link href="/app/commissions/reconciliation" className="text-primary hover:underline">Reconciliation</Link></li>
          </ul>
        </div>
      }
    >
      {c.is_security ? (
        <div className="space-y-1.5">
          <SecuritiesBanner />
          <p className="pl-1 text-xs text-status-security">
            Tracked for FSA production/attribution only. FFS case ref:{' '}
            <Numeric>{c.ffs_case_ref ?? 'no ref'}</Numeric> — the transaction record lives in FFS; no order data.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Amounts</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><Money value={c.total_commission} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">FSA (<Numeric>{c.fsa_split_pct ?? '—'}</Numeric>%)</span><Money value={c.fsa_amount} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Agency (<Numeric>{c.agency_split_pct ?? '—'}</Numeric>%)</span><Money value={c.agency_amount} /></div>
            <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Received</span><Money value={c.received_amount} /></div>
            <p className="pt-1 text-xs text-muted-foreground">License basis: {c.license_basis ?? '—'}. Splits are config defaults — verify.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Reconcile</CardTitle></CardHeader>
          <CardContent><CommissionReconcileControls id={c.id} /></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Receipts</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {receipts.ok && receipts.data.length > 0 ? receipts.data.map((r) => (<div key={r.id} className="flex justify-between border-b py-1 last:border-0"><Numeric>{r.period ?? r.paid_on ?? '—'}</Numeric><Money value={Number(r.amount)} /></div>)) : <p className="text-muted-foreground">No receipts recorded.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Adjustments</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {adjustments.ok && adjustments.data.length > 0 ? adjustments.data.map((a) => (<div key={a.id} className="border-b py-1 last:border-0"><div className="flex justify-between"><span className="capitalize">{a.kind}</span><Money value={Number(a.amount)} /></div><p className="text-xs text-muted-foreground">{a.reason}</p></div>)) : <p className="text-muted-foreground">No adjustments.</p>}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}
