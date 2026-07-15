import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { CLIENT_ALLOWLIST, selectFor, pickAllowed } from '@/lib/portal/allowlist'
export const dynamic = 'force-dynamic'
// P-5 Document Requests (A2). Outstanding items the FSA/case needs.
export default async function ClientDocRequestsPage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let rows: { id: string; requirement: string; status: string }[] = []
  let err: string | null = null
  if (householdId) {
    try {
      const { data } = await getDb().from('document_requests').select(selectFor(CLIENT_ALLOWLIST, 'document_requests')).eq('household_id', householdId).order('created_at', { ascending: false })
      rows = pickAllowed(CLIENT_ALLOWLIST, 'document_requests', (data ?? []) as never[]) as typeof rows
    } catch (e) { err = e instanceof Error ? e.message : 'Failed' }
  }
  return (
    <ListShell title="Document Requests" description="Items we need from you." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Documents', href: '/client/documents' }, { label: 'Requests' }]}>
      {err ? <ErrorState description={err} /> : rows.length === 0 ? <EmptyState title="Nothing outstanding" description="You have no open document requests." /> : (
        <ul className="space-y-2">{rows.map((r) => (<li key={r.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{r.requirement}</span><Badge variant={r.status === 'received' ? 'won' : 'pending'}>{r.status}</Badge></li>))}</ul>
      )}
    </ListShell>
  )
}
