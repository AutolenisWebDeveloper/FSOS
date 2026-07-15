import { ListShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { CommissionList } from '@/components/app/CommissionList'
import { loadCommissions } from '@/lib/data/commissions'

export const dynamic = 'force-dynamic'

// OS-11 Trails (A2). Recurring/12b-1-style trail tracking (config).
export default async function TrailsPage() {
  const res = await loadCommissions({ trailOnly: true })
  return (
    <ListShell title="Trails" description="Recurring trail commissions. Trail rates are config defaults." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Commissions', href: '/app/commissions' }, { label: 'Trails' }]} actions={<AssumptionBadge />}>
      {!res.ok ? <ErrorState description={res.notConfigured ? 'Database not configured.' : res.message} /> : <CommissionList rows={res.rows} emptyLabel="No trail commissions yet" />}
    </ListShell>
  )
}
