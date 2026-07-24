import Link from 'next/link'
import { CalendarClock, FileEdit, Send, AlertTriangle, MessageSquare, Radio } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, StatTile, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface QueueRow {
  id: string
  scheduled_at: string
  status: string
  channel_id: string
  social_channels?: { platform: SocialPlatform; display_name: string | null } | null
}

export default async function SocialOverviewPage() {
  await requireRole('fsa', '/app/social')

  const [inReview, queue, recent] = await Promise.all([
    load<{ id: string }[]>(
      (db) => db.from('social_content').select('id').eq('status', 'IN_REVIEW').is('deleted_at', null),
      [],
    ),
    load<QueueRow[]>(
      (db) =>
        db
          .from('social_schedule_entries')
          .select('id, scheduled_at, status, channel_id, social_channels(platform, display_name)')
          .in('status', ['pending', 'publishing'])
          .is('deleted_at', null)
          .order('scheduled_at', { ascending: true })
          .limit(50),
      [],
    ),
    load<{ id: string; status: string }[]>(
      (db) =>
        db
          .from('social_schedule_entries')
          .select('id, status')
          .in('status', ['published', 'failed'])
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(200),
      [],
    ),
  ])

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Social' }]
  const err = [inReview, queue, recent].find((r) => !r.ok)
  if (err && !err.ok) {
    return (
      <ListShell title="Social" description="Draft, approve, schedule, and publish social content." breadcrumb={breadcrumb}>
        {err.kind === 'not_configured' ? (
          <EmptyState icon={Radio} title="Database not configured" description="Set the Supabase environment variables to load the social overview." />
        ) : (
          <ErrorState description={err.message} />
        )}
      </ListShell>
    )
  }

  const pendingApproval = inReview.ok ? inReview.data.length : 0
  const scheduled = queue.ok ? queue.data.length : 0
  const published = recent.ok ? recent.data.filter((r) => r.status === 'published').length : 0
  const failures = recent.ok ? recent.data.filter((r) => r.status === 'failed').length : 0
  const upcoming = queue.ok ? queue.data.slice(0, 8) : []

  return (
    <ListShell
      title="Social"
      description="Draft, approve, schedule, and publish social content. Every published post keeps its approved version, approver, and timestamp."
      breadcrumb={breadcrumb}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Pending approval" value={pendingApproval} href="/app/social/content" icon={FileEdit} tone={pendingApproval > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Scheduled" value={scheduled} href="/app/social/queue" icon={CalendarClock} tone="brand" />
        <StatTile label="Published" value={published} href="/app/social/analytics" icon={Send} />
        <StatTile label="Failures" value={failures} href="/app/social/queue" icon={AlertTriangle} tone={failures > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Engagement" value={0} href="/app/social/engagement" icon={MessageSquare} hint="awaiting response" />
      </div>

      <Section
        title="Upcoming"
        description="The next posts in the publish queue."
        action={
          <Link href="/app/social/queue" className="text-sm font-medium text-primary hover:underline">
            View queue
          </Link>
        }
      >
        {upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing scheduled"
            description="Approve content, then schedule it to a connected account from the content review screen."
            action={
              <Link href="/app/social/content" className="text-sm font-medium text-primary hover:underline">
                Go to content
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
            {upcoming.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {e.social_channels ? PLATFORM_LABELS[e.social_channels.platform] : 'Account'}
                    {e.social_channels?.display_name ? ` · ${e.social_channels.display_name}` : ''}
                  </p>
                  <p className="numeric text-xs text-muted-foreground">{new Date(e.scheduled_at).toLocaleString()}</p>
                </div>
                <StatusBadge status={e.status === 'publishing' ? 'active' : 'pending'} label={e.status === 'publishing' ? 'Publishing' : 'Scheduled'} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ListShell>
  )
}
