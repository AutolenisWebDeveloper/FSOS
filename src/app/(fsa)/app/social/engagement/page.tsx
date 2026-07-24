import { MessageSquare } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, StatTile, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'
import { EngagementTriage } from './engagement-triage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Row {
  id: string
  platform: SocialPlatform
  engagement_type: string
  author_handle: string | null
  body: string | null
  received_at: string
  resolved_contact_id: string | null
  resolution_status: string
  classification: string | null
  route: string | null
  linked_task_id: string | null
  linked_opportunity_id: string | null
}

const CLASS_BADGE: Record<string, { key: 'won' | 'pending' | 'lost' | 'blocked' | 'draft'; label: string }> = {
  lead: { key: 'won', label: 'Lead' },
  question: { key: 'pending', label: 'Question' },
  complaint: { key: 'lost', label: 'Complaint' },
  positive: { key: 'won', label: 'Positive' },
  spam: { key: 'blocked', label: 'Spam' },
  other: { key: 'draft', label: 'Other' },
}

export default async function SocialEngagementPage() {
  await requireRole('fsa', '/app/social/engagement')

  const res = await load<Row[]>(
    (db) =>
      db
        .from('social_engagement')
        .select(
          'id, platform, engagement_type, author_handle, body, received_at, resolved_contact_id, resolution_status, classification, route, linked_task_id, linked_opportunity_id',
        )
        .not('resolution_status', 'in', '(dismissed)')
        .order('received_at', { ascending: false })
        .limit(200),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Social', href: '/app/social' }, { label: 'Engagement' }]

  if (!res.ok) {
    return (
      <ListShell title="Engagement" description="Inbound comments, mentions, and messages." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={MessageSquare} title="Database not configured" description="Set the Supabase environment variables to load engagement." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows = res.data
  const unmatched = rows.filter((r) => r.resolution_status === 'unmatched')
  const matched = rows.filter((r) => r.resolution_status !== 'unmatched')

  return (
    <ListShell
      title="Engagement"
      description="Inbound comments, mentions, and messages. Authors resolve to existing contacts — never a duplicate record. A real conversation hands off to the CRM."
      breadcrumb={breadcrumb}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Awaiting review" value={unmatched.length} icon={MessageSquare} tone={unmatched.length > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Resolved" value={matched.length} tone="brand" />
        <StatTile label="Total (open)" value={rows.length} />
      </div>

      <Section title="Review queue" description="Unmatched inbound engagement. Resolve to a contact, then create a task or opportunity.">
        {unmatched.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Nothing awaiting review"
            description="Inbound engagement appears here as it is ingested from connected accounts. Nothing to triage right now."
          />
        ) : (
          <ul className="space-y-3">
            {unmatched.map((e) => (
              <EngagementCard key={e.id} e={e} />
            ))}
          </ul>
        )}
      </Section>

      {matched.length > 0 ? (
        <Section title="Resolved" className="mt-6" description="Engagement already linked to a contact or triaged into the CRM.">
          <ul className="space-y-3">
            {matched.map((e) => (
              <EngagementCard key={e.id} e={e} />
            ))}
          </ul>
        </Section>
      ) : null}
    </ListShell>
  )
}

function EngagementCard({ e }: { e: Row }) {
  const cls = CLASS_BADGE[e.classification ?? 'other'] ?? CLASS_BADGE.other
  return (
    <li className="rounded-lg border border-shell-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {e.author_handle || 'Unknown author'}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {PLATFORM_LABELS[e.platform]} · {e.engagement_type}
            </span>
          </p>
          <p className="numeric text-xs text-muted-foreground">{new Date(e.received_at).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={cls.key} label={cls.label} />
          {e.resolution_status !== 'unmatched' ? (
            <StatusBadge status="active" label={e.resolution_status === 'triaged' ? 'Triaged' : 'Matched'} />
          ) : null}
        </div>
      </div>
      {e.body ? <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{e.body}</p> : null}
      <EngagementTriage
        id={e.id}
        resolved={!!e.resolved_contact_id}
        hasTask={!!e.linked_task_id}
        hasOpportunity={!!e.linked_opportunity_id}
      />
    </li>
  )
}
