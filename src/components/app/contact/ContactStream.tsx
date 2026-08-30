'use client'

import * as React from 'react'
import {
  Bot,
  CalendarCheck,
  ChevronDown,
  Circle,
  ClipboardList,
  FileText,
  FileUp,
  GitBranch,
  Mail,
  MessageSquare,
  Phone,
  Pin,
  ShieldCheck,
  StickyNote,
  Target,
} from 'lucide-react'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/archetypes/states'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/dashboards/format'
import { matchesTimelineFilter, timelineGroup, type TimelineFilter } from '@/lib/contacts/record-view'

/*
 * The contact's chronological spine. One merged stream — activity events, sent
 * messages, and household notes — rendered as a single rail so "what happened"
 * reads top to bottom instead of being split across three widgets.
 *
 * Every entry answers WHAT / WHEN / WHO / detail. Long bodies collapse to two
 * lines with an inline expander (progressive disclosure) so a chatty record stays
 * scannable. Filtering is client-side over rows the server already sent — no extra
 * round trip, and no filter that the data cannot honestly support.
 */

export interface StreamEntry {
  id: string
  kind: string | null
  title: string
  body: string | null
  /** Who/what the entry is attributed to, already prefixed ("by …" / "to …"). */
  meta: string | null
  at: string
  /** Extra marker, e.g. a delivery status. */
  status?: string | null
  pinned?: boolean
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  note: StickyNote,
  call: Phone,
  sms: MessageSquare,
  text: MessageSquare,
  email: Mail,
  meeting: CalendarCheck,
  appointment: CalendarCheck,
  appointment_booked: CalendarCheck,
  review: ClipboardList,
  opportunity: Target,
  stage: GitBranch,
  stage_change: GitBranch,
  import: FileUp,
  document: FileText,
  consent_intent: ShieldCheck,
  ai: Bot,
  agent: Bot,
}

const GROUP_ACCENT: Record<string, string> = {
  conversations: 'text-primary ring-primary/25 bg-primary-soft',
  meetings: 'text-status-won ring-status-won/25 bg-status-won/10',
  notes: 'text-gold-deep ring-gold/30 bg-gold/10',
  system: 'text-muted-foreground ring-border bg-muted',
}

function iconFor(kind: string | null) {
  const k = (kind ?? '').toLowerCase()
  if (KIND_ICON[k]) return KIND_ICON[k]
  const hit = Object.keys(KIND_ICON).find((key) => k.includes(key))
  return hit ? KIND_ICON[hit] : Circle
}

export function ContactStream({
  entries,
  filterable = true,
  initialLimit = 8,
  emptyTitle = 'Nothing logged yet',
  emptyDescription = 'Calls, texts, emails, meetings, notes, and system events for this contact appear here.',
  emptyAction,
}: {
  entries: StreamEntry[]
  filterable?: boolean
  initialLimit?: number
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
}) {
  const [filter, setFilter] = React.useState<TimelineFilter>('all')
  const [expanded, setExpanded] = React.useState(false)

  const counts = React.useMemo(() => {
    const c = { all: entries.length, conversations: 0, meetings: 0, notes: 0, system: 0 }
    for (const e of entries) c[timelineGroup(e.kind)] += 1
    return c
  }, [entries])

  const visible = React.useMemo(() => entries.filter((e) => matchesTimelineFilter(e.kind, filter)), [entries, filter])
  const shown = expanded ? visible : visible.slice(0, initialLimit)
  const hidden = visible.length - shown.length

  const options = (
    [
      { value: 'all', label: 'All', hint: counts.all },
      { value: 'conversations', label: 'Conversations', hint: counts.conversations },
      { value: 'meetings', label: 'Meetings', hint: counts.meetings },
      { value: 'notes', label: 'Notes', hint: counts.notes },
      { value: 'system', label: 'System', hint: counts.system },
    ] as const
  ).filter((o) => o.value === 'all' || o.hint > 0)

  if (entries.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
  }

  return (
    <div className="space-y-4">
      {filterable && options.length > 2 ? (
        <Segmented
          options={options}
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setExpanded(false)
          }}
          label="Filter the timeline"
          size="sm"
          className="max-w-full flex-wrap"
        />
      ) : null}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing in this filter yet.
        </p>
      ) : (
        <ol className="relative space-y-0">
          {shown.map((e, i) => (
            <StreamItem key={e.id} entry={e} last={i === shown.length - 1} />
          ))}
        </ol>
      )}

      {hidden > 0 ? (
        <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => setExpanded(true)}>
          <ChevronDown className="h-4 w-4" /> Show {hidden} earlier {hidden === 1 ? 'entry' : 'entries'}
        </Button>
      ) : null}
    </div>
  )
}

function StreamItem({ entry, last }: { entry: StreamEntry; last: boolean }) {
  const Icon = iconFor(entry.kind)
  const group = timelineGroup(entry.kind)
  const [open, setOpen] = React.useState(false)
  const long = (entry.body?.length ?? 0) > 170

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last ? <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-border" /> : null}
      <span
        aria-hidden
        className={cn(
          'relative z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full ring-1',
          GROUP_ACCENT[group],
        )}
      >
        <Icon className="h-[13px] w-[13px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {entry.title}
            {entry.pinned ? <Pin className="h-3.5 w-3.5 text-gold-deep" aria-label="Pinned" /> : null}
          </p>
          <time
            dateTime={entry.at}
            title={new Date(entry.at).toLocaleString()}
            className="numeric shrink-0 text-xs text-muted-foreground"
          >
            {timeAgo(entry.at)}
          </time>
        </div>
        {entry.body ? (
          <p
            className={cn(
              // Cap the measure so a long note stays readable when the stream has
              // the full workspace width to itself (the Activity section).
              'mt-0.5 max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground',
              long && !open && 'line-clamp-2',
            )}
          >
            {entry.body}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {entry.meta ? <span className="min-w-0 max-w-full truncate">{entry.meta}</span> : null}
          {entry.status ? (
            <span className="mono-label text-[10px] text-muted-foreground/90">{entry.status}</span>
          ) : null}
          {long ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {open ? 'Show less' : 'Show more'}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}
