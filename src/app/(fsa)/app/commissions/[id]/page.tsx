import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
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
export default async function CommissionDetailPage({ params }: { params: { id: string } }) {
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
  const fmt = (n: number | null) => (n == null ? '—' : `$${Number(n).toLocaleString('en-US')}`)

  return (
    <DetailShell
      title={`Commission — ${agencyName ?? 'Direct'}`}
      description={`${c.product_family ?? 'unclassified'}${c.is_trail ? ' · trail' : ''}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: agencyName ?? 'Record' }]}
      status={<span className="flex items-center gap-2"><StatusBadge status={c.reconciliation_status === 'matched' ? 'won' : c.reconciliation_status === 'discrepancy' ? 'lost' : 'pending'} label={c.reconciliation_status} />{c.is_security ? <Badge variant="blocked">securities</Badge> : null}<AssumptionBadge /></span>}
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
        <div className="rounded-md border border-status-blocked/40 bg-status-blocked/10 p-3 text-sm text-status-blocked">
          Securities commission — tracked for FSA production/attribution. The transaction record lives in FFS. FSOS stores only a reference ({c.ffs_case_ref ?? 'no ref'}); no order data.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Amounts</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="tabular-nums">{fmt(c.total_commission)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">FSA ({c.fsa_split_pct ?? '—'}%)</span><span className="tabular-nums">{fmt(c.fsa_amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Agency ({c.agency_split_pct ?? '—'}%)</span><span className="tabular-nums">{fmt(c.agency_amount)}</span></div>
            <div className="flex justify-between border-t pt-1"><span className="text-muted-foreground">Received</span><span className="tabular-nums">{fmt(c.received_amount)}</span></div>
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
            {receipts.ok && receipts.data.length > 0 ? receipts.data.map((r) => (<div key={r.id} className="flex justify-between border-b py-1 last:border-0"><span>{r.period ?? r.paid_on ?? '—'}</span><span className="tabular-nums">${Number(r.amount).toLocaleString('en-US')}</span></div>)) : <p className="text-muted-foreground">No receipts recorded.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Adjustments</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {adjustments.ok && adjustments.data.length > 0 ? adjustments.data.map((a) => (<div key={a.id} className="border-b py-1 last:border-0"><div className="flex justify-between"><span className="capitalize">{a.kind}</span><span className="tabular-nums">${Number(a.amount).toLocaleString('en-US')}</span></div><p className="text-xs text-muted-foreground">{a.reason}</p></div>)) : <p className="text-muted-foreground">No adjustments.</p>}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}
