import { CalendarClock } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'
import { QueueEntryActions } from './queue-actions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Row {
  id: string
  scheduled_at: string
  timezone: string
  status: string
  attempts: number
  last_error: string | null
  social_channels?: { platform: SocialPlatform; display_name: string | null } | null
  social_content_versions?: { version_no: number; social_content?: { title: string | null } | null } | null
}

const STATUS_BADGE: Record<string, { key: 'pending' | 'active' | 'won' | 'lost' | 'blocked'; label: string }> = {
  pending: { key: 'pending', label: 'Scheduled' },
  publishing: { key: 'active', label: 'Publishing' },
  published: { key: 'won', label: 'Published' },
  failed: { key: 'lost', label: 'Failed' },
  cancelled: { key: 'blocked', label: 'Cancelled' },
}

export default async function SocialQueuePage() {
  await requireRole('fsa', '/app/social/queue')

  const res = await load<Row[]>(
    (db) =>
      db
        .from('social_schedule_entries')
        .select(
          'id, scheduled_at, timezone, status, attempts, last_error, social_channels(platform, display_name), social_content_versions(version_no, social_content(title))',
        )
        .not('status', 'in', '(cancelled)')
        .is('deleted_at', null)
        .order('scheduled_at', { ascending: true })
        .limit(200),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Social', href: '/app/social' }, { label: 'Queue' }]

  if (!res.ok) {
    return (
      <ListShell title="Publish queue" description="Scheduled and in-flight social posts." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={CalendarClock} title="Database not configured" description="Set the Supabase environment variables to load the queue." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows = res.data

  return (
    <ListShell
      title="Publish queue"
      description="Scheduled and in-flight social posts. Publishing runs on the durable job path — each item publishes exactly once, with retry and dead-letter on failure."
      breadcrumb={breadcrumb}
    >
      <Section title="Queue">
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Queue is empty"
            description="Approve content and schedule it to a connected account. Scheduled posts appear here until they publish."
          />
        ) : (
          <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
            {rows.map((e) => {
              const badge = STATUS_BADGE[e.status] ?? { key: 'pending' as const, label: e.status }
              const title = e.social_content_versions?.social_content?.title
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {title || 'Untitled post'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.social_channels ? PLATFORM_LABELS[e.social_channels.platform] : 'Account'}
                      {e.social_channels?.display_name ? ` · ${e.social_channels.display_name}` : ''}
                      {' · '}
                      <span className="numeric">{new Date(e.scheduled_at).toLocaleString()}</span>
                      {e.attempts > 0 ? <span className="numeric"> · {e.attempts} attempt(s)</span> : null}
                    </p>
                    {e.status === 'failed' && e.last_error ? (
                      <p className="mt-1 text-xs text-status-lost">{e.last_error}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={badge.key} label={badge.label} />
                    {e.status === 'pending' || e.status === 'failed' ? (
                      <QueueEntryActions id={e.id} scheduledAt={e.scheduled_at} />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </ListShell>
  )
}
