import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { loadAll } from '@/lib/data/query'
import { PolicyList, type PolicyRow } from '@/components/app/PolicyList'

export const dynamic = 'force-dynamic'

// OS-05 Policy Directory (A2). Full book — loadAll pages past PostgREST's row cap
// so every policy (thousands, from the district book) is loaded, not truncated.
export default async function PoliciesPage() {
  const [policies, households] = await Promise.all([
    loadAll<{ id: string; policy_number: string | null; household_id: string; status: string; is_with_us: boolean; is_security: boolean; renewal_date: string | null; x_date: string | null; conversion_deadline: string | null }>(
      (db) => db.from('household_policies').select('id, policy_number, household_id, status, is_with_us, is_security, renewal_date, x_date, conversion_deadline').is('deleted_at', null).order('created_at', { ascending: false }),
    ),
    loadAll<{ id: string; primary_name: string }>((db) => db.from('households').select('id, primary_name').is('deleted_at', null)),
  ])

  const actions = (
    <Button asChild>
      <Link href="/app/policies/new"><Plus className="h-4 w-4" /> Record policy</Link>
    </Button>
  )

  let body: React.ReactNode
  if (!policies.ok) {
    body = policies.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load policies." /> : <ErrorState description={policies.message} />
  } else {
    const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))
    const rows: PolicyRow[] = policies.data.map((p) => ({ ...p, household_name: hhMap.get(p.household_id) ?? null }))
    body = <PolicyList rows={rows} />
  }

  return (
    <ListShell title="Policies & Coverage" description="Own-book policies and competitor X-date policies." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Policies' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
