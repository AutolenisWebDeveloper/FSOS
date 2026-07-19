import * as React from 'react'
import Link from 'next/link'
import { UserPlus, AlertTriangle, Clock, ChevronRight, CircleAlert, CircleCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import type { WidgetValue } from '@/lib/analytics/metrics'

/*
 * OS-01 Triage band — the "read me first" section of the Executive Dashboard.
 * Promotes the three action-needed queues (speed-to-lead, AI escalations,
 * past-due work) from scattered tiles into one prominent band above the
 * personalized grid, so the home screen leads with WHAT NEEDS A DECISION today.
 *
 * Loud when work is waiting (gold "attention"), calm when the desk is clear —
 * the same triage grammar the widget grid already uses (isAttentionWidget /
 * catalog `attention`), elevated to the anchor band. Server-component-safe.
 */

const ICONS: Record<string, LucideIcon> = {
  referrals_awaiting: UserPlus,
  ai_escalations: AlertTriangle,
  overdue_tasks: Clock,
}

// The queues that constitute "needs you", in priority order (speed-to-lead first).
const TRIAGE_KEYS = ['referrals_awaiting', 'ai_escalations', 'overdue_tasks'] as const

function TriageTile({ w }: { w: WidgetValue }) {
  const Icon = ICONS[w.key] ?? CircleAlert
  const failed = w.value === null
  const hot = !failed && (w.value ?? 0) > 0

  return (
    <Link
      href={w.href}
      className={cn(
        'group relative flex items-center gap-4 rounded-xl border bg-card p-4 transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        hot
          ? 'border-gold/45 bg-gold/[0.06] hover:border-gold/70 hover:shadow-elev-md'
          : 'hover:border-primary/40 hover:shadow-elev-sm',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          hot ? 'bg-gold/15 text-gold-deep' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <MonoLabel>{w.label}</MonoLabel>
        <div className="mt-1 flex items-baseline gap-2">
          <Numeric
            className={cn(
              'text-[26px] font-semibold leading-none tracking-tight',
              failed ? 'text-muted-foreground' : hot ? 'text-gold-deep' : 'text-foreground',
            )}
          >
            {failed ? '—' : w.value}
          </Numeric>
          {w.hint ? <span className="truncate text-xs text-muted-foreground">{w.hint}</span> : null}
        </div>
        {failed ? <p className="mt-1 text-xs text-status-lost">Couldn&apos;t load — retry</p> : null}
      </div>
      <ChevronRight
        className={cn(
          'h-4 w-4 shrink-0 translate-x-0 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5',
          hot ? 'text-gold-deep/60' : 'group-hover:text-primary',
        )}
        aria-hidden
      />
    </Link>
  )
}

/**
 * Renders the triage band from the already-computed dashboard widgets. Accepts the
 * full widget set and selects the attention queues itself, so the page passes the
 * same `computeWidgets` result it feeds the grid (no extra query).
 */
export function TriageBand({ widgets }: { widgets: WidgetValue[] }) {
  const byKey = new Map(widgets.map((w) => [w.key, w]))
  const tiles = TRIAGE_KEYS.map((k) => byKey.get(k)).filter((w): w is WidgetValue => Boolean(w))
  if (tiles.length === 0) return null

  // "Needs action" counts only queues that both loaded and are non-zero.
  const needing = tiles.filter((w) => w.value !== null && (w.value ?? 0) > 0).length
  const allClear = needing === 0

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>Needs you today</MonoLabel>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
            allClear
              ? 'border-status-won/30 bg-status-won/10 text-status-won'
              : 'border-gold/40 bg-gold/12 text-gold-deep',
          )}
        >
          {allClear ? (
            <>
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              All clear
            </>
          ) : (
            <>
              <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              <Numeric>{needing}</Numeric>
              {needing === 1 ? 'queue needs action' : 'queues need action'}
            </>
          )}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((w) => (
          <TriageTile key={w.key} w={w} />
        ))}
      </div>
    </section>
  )
}
