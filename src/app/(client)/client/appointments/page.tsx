import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { CLIENT_ALLOWLIST, selectFor, pickAllowed } from '@/lib/portal/allowlist'
export const dynamic = 'force-dynamic'
// P-5 Appointments (A2).
export default async function ClientAppointmentsPage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let rows: { id: string; scheduled_at: string | null; status: string }[] = []
  let err: string | null = null
  if (householdId) {
    try {
      const { data } = await getDb().from('appointments').select(selectFor(CLIENT_ALLOWLIST, 'appointments')).eq('household_id', householdId).order('scheduled_at', { ascending: false })
      rows = pickAllowed(CLIENT_ALLOWLIST, 'appointments', (data ?? []) as never[]) as typeof rows
    } catch (e) { err = e instanceof Error ? e.message : 'Failed' }
  }
  return (
    <ListShell title="Appointments" description="Your scheduled meetings." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Appointments' }]}>
      {err ? <ErrorState description={err} /> : rows.length === 0 ? <EmptyState title="No appointments" description="Book a meeting from Schedule." /> : (
        <ul className="space-y-2">{rows.map((r) => (<li key={r.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString('en-US') : 'TBD'}</span><Badge variant={r.status === 'completed' ? 'won' : 'active'}>{r.status}</Badge></li>))}</ul>
      )}
    </ListShell>
  )
}
