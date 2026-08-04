import {
  Circle,
  Phone,
  MessageSquare,
  Mail,
  CalendarCheck,
  ClipboardList,
  Target,
  GitBranch,
  FileUp,
  FileText,
  StickyNote,
  Bot,
} from 'lucide-react'
import { load } from '@/lib/data/query'
import { timeAgo, humanize } from '@/lib/dashboards/format'
import { EmptyState, ErrorState } from '@/components/archetypes'

/*
 * Contact 360 Timeline (redesign spec §9) — the chronological spine of the record.
 * A single stream of everything logged against the household, read from the
 * append-only `activities` stream (the same table LogActivityButton writes to and
 * that services log appointments/imports/stage changes/comms to). Reusable: pass
 * a member entity to render the member-scoped variant on Member Detail (§4.3).
 * Server component — RLS scopes the read to the caller's book.
 */

interface ActivityRow {
  id: string
  kind: string | null
  note: string | null
  actor: string | null
  created_at: string
}

const KIND_ICON: Record<string, typeof Circle> = {
  note: StickyNote,
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  appointment: CalendarCheck,
  review: ClipboardList,
  opportunity: Target,
  stage: GitBranch,
  stage_change: GitBranch,
  import: FileUp,
  document: FileText,
  ai: Bot,
  agent: Bot,
}

function iconFor(kind: string | null) {
  return (kind && KIND_ICON[kind]) || Circle
}

export async function ContactTimeline({
  entityType = 'household',
  entityId,
  limit = 40,
  heading = 'Timeline',
}: {
  entityType?: string
  entityId: string
  limit?: number
  heading?: string
}) {
  const res = await load<ActivityRow[]>(
    (db) =>
      db
        .from('activities')
        .select('id, kind, note, actor, created_at')
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(limit),
    [],
  )

  return (
    <section aria-label={heading} className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
      {!res.ok ? (
        <ErrorState description="Could not load the timeline." />
      ) : res.data.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          description="Calls, emails, appointments, reviews, imports, and notes appear here as they happen."
        />
      ) : (
        <ol className="relative space-y-4 border-l pl-4">
          {res.data.map((entry) => {
            const Icon = iconFor(entry.kind)
            return (
              <li key={entry.id} className="relative">
                <span
                  className="absolute -left-[1.4rem] flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground"
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </span>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{humanize(entry.kind) || 'Activity'}</p>
                  <time
                    dateTime={entry.created_at}
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                    title={new Date(entry.created_at).toLocaleString()}
                  >
                    {timeAgo(entry.created_at)}
                  </time>
                </div>
                {entry.note ? <p className="mt-0.5 text-sm text-muted-foreground">{entry.note}</p> : null}
                {entry.actor ? <p className="mt-0.5 text-xs text-muted-foreground">by {entry.actor}</p> : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
