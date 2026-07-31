import Link from 'next/link'
import { Activity as ActivityIcon } from 'lucide-react'
import { MonoLabel } from '@/components/ui/typography'
import { EmptyNote } from '@/components/dashboards/primitives'
import type { ActivityItem } from '@/lib/dashboards/executive'

// Activity timeline — the book's most recent events, straight from the activities
// table. Real rows only; an empty book shows a calm note, never sample entries.

function humanizeKind(kind: string): string {
  return kind.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const now = Date.now()
  return (
    <section aria-label="Activity" className="flex flex-col rounded-2xl border border-border bg-card shadow-elev-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <MonoLabel className="text-muted-foreground">Activity</MonoLabel>
      </header>
      {items.length === 0 ? (
        <div className="p-4"><EmptyNote>No activity logged yet.</EmptyNote></div>
      ) : (
        <ol className="flex-1 divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                <ActivityIcon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{humanizeKind(a.kind)}</p>
                {a.note ? <p className="truncate text-xs text-muted-foreground">{a.note}</p> : a.entity_type ? <p className="truncate text-xs text-muted-foreground">{humanizeKind(a.entity_type)}</p> : null}
              </div>
              <time className="shrink-0 text-xs tabular-nums text-muted-foreground" dateTime={a.created_at}>{relativeTime(a.created_at, now)}</time>
            </li>
          ))}
        </ol>
      )}
      <Link
        href="/app/notifications"
        className="mt-auto border-t border-border px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        View all activity
      </Link>
    </section>
  )
}
