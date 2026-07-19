import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { FnaGenerator } from '@/components/fna/FnaGenerator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HouseholdOption {
  id: string
  primary_name: string
}

// Legacy-port FNA Generator (docs/legacy-port.md §2.1) — the highest-value keeper.
// Select a household, generate a Financial Needs Analysis through the AI gateway,
// review it (FINRA disclaimer verbatim, securities firewall marked, recommendation
// language hard-blocked), then save it to Document OS. Roles: fsa, licensed_staff.
export default async function FnaPage() {
  await requireRole('fsa', '/app/fna')

  const res = await load<HouseholdOption[]>(
    (db) =>
      db
        .from('households')
        .select('id, primary_name')
        .is('deleted_at', null)
        .order('primary_name', { ascending: true }),
    [],
  )

  const header = (
    <PageHeader
      title="FNA Generator"
      description="Generate a Financial Needs Analysis for a household — educational needs & gaps only, reviewed by a licensed FSA before it reaches a client."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'FNA Generator' }]}
    />
  )

  if (!res.ok) {
    return (
      <div className="space-y-6">
        {header}
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {res.data.length === 0 ? (
        <EmptyState
          title="No households yet"
          description="Add a household from a referral first, then generate its Financial Needs Analysis here."
        />
      ) : (
        <FnaGenerator households={res.data} />
      )}
    </div>
  )
}
