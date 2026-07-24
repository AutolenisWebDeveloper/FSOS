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

// FNA narrative generation (preserved from the original /app/fna landing — the
// generator is now ONE action inside the command center, not the entry point;
// build instruction §8). Generate → review → save to Document OS still works
// unchanged; existing saved FNAs still open. Roles: fsa, licensed_staff.
export default async function FnaGeneratePage() {
  await requireRole('fsa', '/app/fna/generate')

  const res = await load<HouseholdOption[]>(
    (db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name', { ascending: true }),
    [],
  )

  const header = (
    <PageHeader
      title="Generate FNA narrative"
      description="AI-drafted educational needs & gaps for a household — reviewed by a licensed FSA before it reaches a client. Numbers shown to clients come from the deterministic engine, not the model."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Generate narrative' }]}
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
        <EmptyState title="No households yet" description="Add a household from a referral first, then generate its Financial Needs Analysis narrative here." />
      ) : (
        <FnaGenerator households={res.data} />
      )}
    </div>
  )
}
