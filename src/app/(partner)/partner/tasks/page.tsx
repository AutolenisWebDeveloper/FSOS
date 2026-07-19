import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'

// P-4 Tasks (A2). Action items assigned to the agency.
export default async function PartnerTasksPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []
  let rows: { id: string; title: string; completed: boolean; due_at: string | null }[] = []
  let err: string | null = null
  if (agencyIds.length) {
    try {
      const { data } = await getDb().from('work_tasks').select('id, title, completed, due_at').eq('entity_type', 'agency').in('entity_id', agencyIds).order('created_at', { ascending: false })
      rows = (data ?? []) as typeof rows
    } catch (e) { err = e instanceof Error ? e.message : 'Failed' }
  }
  return (
    <ListShell title="Tasks" description="Action items for your agency." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Tasks' }]}>
      {err ? <ErrorState description={err} /> : rows.length === 0 ? <EmptyState title="No tasks" description="Action items from your FSA appear here." /> : (
        <ul className="space-y-2">{rows.map((t) => (<li key={t.id} className="flex items-center justify-between rounded-md border p-3 text-sm"><span>{t.title}</span><Badge variant={t.completed ? 'won' : 'pending'}>{t.completed ? 'done' : 'open'}</Badge></li>))}</ul>
      )}
    </ListShell>
  )
}
