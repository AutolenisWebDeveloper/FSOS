import { ListShell, ErrorState } from '@/components/archetypes'
import { CommissionList } from '@/components/app/CommissionList'
import { loadCommissions } from '@/lib/data/commissions'

export const dynamic = 'force-dynamic'

// OS-11 Discrepancies (A2). Actionable expected-vs-received gaps.
export default async function DiscrepanciesPage() {
  const res = await loadCommissions({ status: 'discrepancy' })
  return (
    <ListShell title="Discrepancies" description="Expected vs received gaps flagged by reconciliation. Each is actionable." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Discrepancies' }]}>
      {!res.ok ? <ErrorState description={res.notConfigured ? 'Database not configured.' : res.message} /> : <CommissionList rows={res.rows} emptyLabel="No discrepancies — everything reconciles" />}
    </ListShell>
  )
}
