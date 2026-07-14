import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { TaskList, type TaskRow } from '@/components/app/TaskList'

export const dynamic = 'force-dynamic'

// P0 My Tasks (A2). Manual + workflow/agent-generated work items.
export default async function TasksPage() {
  const res = await load<TaskRow[]>(
    (db) =>
      db
        .from('work_tasks')
        .select('id, title, entity_type, entity_id, source, due_at, completed')
        .is('deleted_at', null)
        .order('due_at', { ascending: true, nullsFirst: false }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body =
      res.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load tasks." />
      ) : (
        <ErrorState description={res.message} />
      )
  } else {
    body = <TaskList rows={res.data} />
  }

  return (
    <ListShell
      title="My Tasks"
      description="Follow-ups, reminders, and work items — created manually or by workflows and agents."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Tasks' }]}
    >
      {body}
    </ListShell>
  )
}
