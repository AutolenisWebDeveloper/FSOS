// src/components/comms/CommTimeline.tsx
// Reusable, presentational timeline for the unified comms + audit history. Takes already-loaded,
// already-redacted TimelineEntry[] (see lib/comms/timeline-load.ts) and renders them newest-first.
// Purely a view — it holds no data logic — so any server surface can mount it: the appointment
// detail (P2.3) and the communication-history / send-decision audit (P5.13) render the SAME
// component over the SAME entries, no fork.

import { Mail, MessageSquare, History, ArrowDownLeft } from 'lucide-react'
import { EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { statusBadge, type TimelineEntry } from '@/lib/comms/timeline'

function IconFor({ entry }: { entry: TimelineEntry }) {
  const cls = 'h-4 w-4'
  if (entry.source === 'audit') return <History className={cls} aria-hidden />
  if (entry.direction === 'inbound') return <ArrowDownLeft className={cls} aria-hidden />
  if (entry.channel === 'email') return <Mail className={cls} aria-hidden />
  return <MessageSquare className={cls} aria-hidden />
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function CommTimeline({ entries, emptyHint }: { entries: TimelineEntry[]; emptyHint?: string }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No activity yet"
        description={emptyHint ?? 'Messages, delivery events, and record changes will appear here as they happen.'}
      />
    )
  }

  return (
    <ol className="relative space-y-4 border-l pl-6" aria-label="Activity timeline">
      {entries.map((e) => {
        const badge = e.status ? statusBadge(e.status) : null
        return (
          <li key={e.id} className="relative">
            <span
              aria-hidden
              className="absolute -left-[1.9rem] flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground"
            >
              <IconFor entry={e} />
            </span>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-medium text-foreground">{e.title}</p>
              {badge ? <StatusBadge status={badge.key as StatusKey} label={badge.label} /> : null}
              <time className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground" dateTime={e.at}>
                {fmt(e.at)}
              </time>
            </div>
            {e.recipient ? <p className="mt-0.5 text-xs text-muted-foreground">To: {e.recipient}</p> : null}
            {e.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{e.body}</p> : null}
            {e.detail ? <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p> : null}
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              {e.actor ? <span>by {e.actor}</span> : null}
              {e.providerId ? <span className="font-mono">id {e.providerId}</span> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
