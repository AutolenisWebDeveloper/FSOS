import { requireRole, getServerSession } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { NotificationList } from '@/components/app/NotificationList'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type NotificationRow = {
  id: string
  kind: string | null
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

// Notifications page (ports the legacy top-bar bell onto the real notifications
// table). User-scoped read; mark-read via /api/app/notifications. Roles: fsa,
// licensed_staff, super_admin (portal-gated by the (fsa) layout).
export default async function NotificationsPage() {
  await requireRole('fsa', '/app/notifications')
  const session = await getServerSession()

  const res = session
    ? await load<NotificationRow[]>(
        (db) =>
          db
            .from('notifications')
            .select('id, kind, title, body, link, read_at, created_at')
            .eq('user_id', session.userId)
            .order('created_at', { ascending: false })
            .limit(50),
        [],
      )
    : { ok: true as const, data: [] as NotificationRow[] }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Notifications"
        description="Alerts and updates from FSOS, scoped to you."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Notifications' }]}
      />
      <NotificationList
        initial={res.ok ? res.data : []}
        initialError={res.ok ? undefined : res.kind === 'not_configured' ? 'Database not configured.' : res.message}
      />
    </div>
  )
}
