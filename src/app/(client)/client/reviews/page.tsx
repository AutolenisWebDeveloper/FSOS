import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { householdIdFor } from '@/lib/portal/scope'
import { CLIENT_ALLOWLIST, selectFor, pickAllowed } from '@/lib/portal/allowlist'
export const dynamic = 'force-dynamic'
// P-5 Reviews (A2). Permitted policy-review info only — no outcome record, no securities.
export default async function ClientReviewsPage() {
  const session = await getServerSession()
  const householdId = session ? await householdIdFor(session) : null
  let rows: { id: string; type: string; stage: string; scheduled_at: string | null }[] = []
  let err: string | null = null
  if (householdId) {
    try {
      const { data } = await getDb().from('reviews').select(selectFor(CLIENT_ALLOWLIST, 'reviews')).eq('household_id', householdId).is('deleted_at', null).order('scheduled_at', { ascending: false })
      rows = pickAllowed(CLIENT_ALLOWLIST, 'reviews', (data ?? []) as never[]) as typeof rows
    } catch (e) { err = e instanceof Error ? e.message : 'Failed' }
  }
  return (
    <ListShell title="Reviews" description="Your review schedule. The outcome record and any securities detail are never shown here." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Reviews' }]}>
      {err ? <ErrorState description={err} /> : rows.length === 0 ? <EmptyState title="No reviews" description="Your review schedule appears here." /> : (
        <ul className="space-y-2">{rows.map((r) => (<li key={r.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span className="capitalize">{r.type.replace(/_/g, ' ')}{r.scheduled_at ? ` · ${new Date(r.scheduled_at).toLocaleDateString('en-US')}` : ''}</span><Badge variant="outline">{r.stage.replace(/_/g, ' ')}</Badge></li>))}</ul>
      )}
    </ListShell>
  )
}
