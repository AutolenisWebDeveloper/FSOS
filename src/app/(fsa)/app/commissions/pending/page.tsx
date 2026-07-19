import { ListShell, ErrorState } from '@/components/archetypes'
import { CommissionList } from '@/components/app/CommissionList'
import { loadCommissions } from '@/lib/data/commissions'

export const dynamic = 'force-dynamic'

// OS-11 Pending Commissions (A2).
export default async function Page() {
  const res = await loadCommissions({ status: 'expected' })
  return (
    <ListShell title="Pending Commissions" description="Awaiting receipt." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Pending Commissions' }]}>
      {!res.ok ? (
        <ErrorState description={res.notConfigured ? 'Database not configured.' : res.message} />
      ) : (
        <CommissionList rows={res.rows} emptyLabel="No commissions in this view" />
      )}
    </ListShell>
  )
}
