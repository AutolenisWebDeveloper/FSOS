import Link from 'next/link'
import { DashboardShell, StatTile, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-11 Commission Dashboard (A1).
export default async function CommissionsDashboardPage() {
  const comms = await load<{ id: string; total_commission: number; received_amount: number; is_security: boolean; reconciliation_status: string; product_family: string | null }[]>(
    (db) => db.from('commissions').select('id, total_commission, received_amount, is_security, reconciliation_status, product_family'),
    [],
  )
  if (!comms.ok) return <DashboardShell title="Commissions" description="Expected vs received, splits, reconciliation.">{comms.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={comms.message} />}</DashboardShell>

  const rows = comms.data
  const expected = rows.reduce((s, c) => s + Number(c.total_commission || 0), 0)
  const received = rows.reduce((s, c) => s + Number(c.received_amount || 0), 0)
  const pending = rows.filter((c) => c.reconciliation_status === 'expected').length
  const discrepancies = rows.filter((c) => c.reconciliation_status === 'discrepancy').length
  const life = rows.filter((c) => !c.is_security).reduce((s, c) => s + Number(c.total_commission || 0), 0)
  const securities = rows.filter((c) => c.is_security).reduce((s, c) => s + Number(c.total_commission || 0), 0)

  const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

  return (
    <DashboardShell title="Commissions" description="Expected vs received, splits, reconciliation.">
      <StatTile label="Expected" value={fmt(expected)} href="/app/commissions/expected" />
      <StatTile label="Received" value={fmt(received)} href="/app/commissions/received" />
      <StatTile label="Pending" value={pending} href="/app/commissions/pending" />
      <StatTile label="Discrepancies" value={discrepancies} href="/app/commissions/discrepancies" />
      <StatTile label="Life production" value={fmt(life)} href="/app/commissions/expected" hint="Life / annuity / education" />
      <StatTile label="Securities production" value={fmt(securities)} href="/app/commissions/expected" hint="Tracked for attribution; record lives in FFS" />
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <AssumptionBadge />
          <span className="text-muted-foreground">Split values are labeled config defaults — verify against contract. None is a Farmers-published figure.</span>
          <Link href="/app/commissions/gdc" className="text-primary hover:underline">GDC &amp; tier</Link>
          <Link href="/app/commissions/splits" className="text-primary hover:underline">Configure splits</Link>
          <Link href="/app/commissions/reconciliation" className="text-primary hover:underline">Reconciliation</Link>
          <Link href="/app/commissions/statements" className="text-primary hover:underline">Statements</Link>
        </div>
      </div>
    </DashboardShell>
  )
}
