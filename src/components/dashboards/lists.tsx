import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Numeric, MonoLabel } from '@/components/ui/typography'
import { EmptyNote, toneBar, type Tone } from './primitives'

/*
 * List/feed widgets for the Production Operations command centers.
 * Server-Component-safe; drill-in links keep every row anti-dead-end.
 */

// Soft chip tint for feed markers, aligned to the tone vocabulary.
const FEED_CHIP: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  brand: 'bg-primary-soft/70 text-primary',
  attention: 'bg-gold/15 text-gold-deep',
  positive: 'bg-status-won/12 text-status-won',
  security: 'bg-status-security/12 text-status-security',
  critical: 'bg-destructive/10 text-destructive',
}

// ─── Leaderboard: ranked entities with a metric bar ───────────────────────────

export interface LeaderRow {
  name: string
  value: number
  href?: string
  /** Right-aligned formatted primary figure (defaults to value). */
  display?: React.ReactNode
  /** Small caption under the name (e.g. owner, penetration). */
  meta?: string
  tone?: Tone
}

export function Leaderboard({
  rows,
  format = (n) => n.toLocaleString(),
  emptyLabel = 'No agencies ranked yet.',
}: {
  rows: LeaderRow[]
  format?: (n: number) => string
  emptyLabel?: string
}) {
  if (!rows.length) return <EmptyNote>{emptyLabel}</EmptyNote>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ol className="space-y-2.5">
      {rows.map((row, i) => {
        const pct = Math.max(row.value > 0 ? 4 : 0, Math.round((row.value / max) * 100))
        const tone = row.tone ?? (i === 0 ? 'brand' : 'neutral')
        const body = (
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                <Numeric className="shrink-0 text-sm font-semibold tabular-nums">{row.display ?? format(row.value)}</Numeric>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', toneBar(tone))} style={{ width: `${pct}%` }} aria-hidden />
                </div>
                {row.meta ? <span className="shrink-0 text-[11px] text-muted-foreground">{row.meta}</span> : null}
              </div>
            </div>
          </div>
        )
        return (
          <li key={`${row.name}-${i}`}>
            {row.href ? (
              <Link
                href={row.href}
                className="block rounded-lg px-1.5 py-1 -mx-1.5 transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ─── ActivityFeed: chronological outreach / event log ─────────────────────────

export interface FeedItem {
  id: string
  icon?: LucideIcon
  title: React.ReactNode
  meta?: string
  time?: string
  href?: string
  tone?: Tone
}

export function ActivityFeed({ items, emptyLabel = 'No recent activity.' }: { items: FeedItem[]; emptyLabel?: string }) {
  if (!items.length) return <EmptyNote>{emptyLabel}</EmptyNote>
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon
        const tone = item.tone ?? 'brand'
        const body = (
          <div className="flex gap-3 py-1.5">
            <span className={cn('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-border/60', FEED_CHIP[tone])} aria-hidden>
              {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2} /> : <span className={cn('h-1.5 w-1.5 rounded-full', toneBar(tone))} />}
            </span>
            <div className="min-w-0 flex-1 border-b pb-2">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm text-foreground">{item.title}</p>
                {item.time ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{item.time}</span> : null}
              </div>
              {item.meta ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.meta}</p> : null}
            </div>
          </div>
        )
        return (
          <li key={item.id}>
            {item.href ? (
              <Link href={item.href} className="block rounded-lg transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── QueueList: actionable work items (follow-ups / tasks) ─────────────────────

export interface QueueItem {
  id: string
  title: React.ReactNode
  subtitle?: string
  href?: string
  right?: React.ReactNode
  tone?: Tone
}

export function QueueList({ items, emptyLabel = 'Queue is clear.' }: { items: QueueItem[]; emptyLabel?: string }) {
  if (!items.length) return <EmptyNote>{emptyLabel}</EmptyNote>
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const tone = item.tone ?? 'neutral'
        const body = (
          <div className="flex items-center gap-3 py-2.5">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', toneBar(tone))} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
              {item.subtitle ? <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p> : null}
            </div>
            {item.right ? <div className="shrink-0 text-right">{item.right}</div> : null}
            {item.href ? <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" aria-hidden /> : null}
          </div>
        )
        return (
          <li key={item.id} className="group">
            {item.href ? (
              <Link href={item.href} className="block rounded-lg px-1 -mx-1 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A compact list-header row for tables/queues inside a Panel. */
export function ListCaption({ children }: { children: React.ReactNode }) {
  return <MonoLabel className="mb-2 block text-[10px]">{children}</MonoLabel>
}
