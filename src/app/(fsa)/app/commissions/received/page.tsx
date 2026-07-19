import { ListShell, ErrorState } from '@/components/archetypes'
import { CommissionList } from '@/components/app/CommissionList'
import { loadCommissions } from '@/lib/data/commissions'

export const dynamic = 'force-dynamic'

// OS-11 Received Commissions (A2).
export default async function Page() {
  const res = await loadCommissions({ status: 'received' })
  return (
    <ListShell title="Received Commissions" description="Received and matched." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Received Commissions' }]}>
      {!res.ok ? (
        <ErrorState description={res.notConfigured ? 'Database not configured.' : res.message} />
      ) : (
        <CommissionList rows={res.rows} emptyLabel="No commissions in this view" />
      )}
    </ListShell>
  )
}
