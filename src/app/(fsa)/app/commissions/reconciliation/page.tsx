import Link from 'next/link'
import { DetailShell, ErrorState, StatTile } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-11 Reconciliation (A3). Match expected → received; flag gaps → discrepancies.
export default async function ReconciliationPage() {
  const comms = await load<{ id: string; total_commission: number; received_amount: number; reconciliation_status: string }[]>(
    (db) => db.from('commissions').select('id, total_commission, received_amount, reconciliation_status'),
    [],
  )
  if (!comms.ok) return <DetailShell title="Reconciliation" breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Reconciliation' }]}><ErrorState description={comms.kind === 'not_configured' ? 'Database not configured.' : comms.message} /></DetailShell>

  const rows = comms.data
  const expected = rows.filter((c) => c.reconciliation_status === 'expected').length
  const received = rows.filter((c) => c.reconciliation_status === 'received').length
  const matched = rows.filter((c) => c.reconciliation_status === 'matched').length
  const discrepancy = rows.filter((c) => c.reconciliation_status === 'discrepancy').length

  return (
    <DetailShell
      title="Reconciliation"
      description="Match expected to received; flag gaps. The commission-reconcile job runs this periodically (idempotent)."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Reconciliation' }]}
      actions={<Button asChild variant="outline"><Link href="/app/commissions/discrepancies">Discrepancies</Link></Button>}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Expected" value={expected} href="/app/commissions/expected" />
        <StatTile label="Received" value={received} href="/app/commissions/received" />
        <StatTile label="Matched" value={matched} href="/app/commissions/received" />
        <StatTile label="Discrepancies" value={discrepancy} href="/app/commissions/discrepancies" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">How reconciliation works</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Placement creates an <strong>expected</strong> commission from split defaults. Recording a <strong>received</strong> amount (manual/CSV — no Farmers payout API) matches it. The <code>commission-reconcile</code> job flags any expected-vs-received gap as a <strong>discrepancy</strong>, which ages into the discrepancy queue for manual resolution. Reconciliation is idempotent.</p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
