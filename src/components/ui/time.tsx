'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Numeric } from '@/components/ui/typography'

/*
 * FSOS timestamp primitive.
 *
 * Twelve comms surfaces rendered timestamps as
 * `new Date(row.created_at).toLocaleString('en-US')` inside SERVER Components.
 * Two consequences:
 *
 *  1. Wrong clock. `toLocaleString` resolves against the *server's* timezone, which
 *     on Vercel is UTC — so an advisor in Fort Worth read every send time five or
 *     six hours off. On a quiet-hours compliance log, where the whole question is
 *     "what time was it for the recipient," that is not a cosmetic problem.
 *  2. Wrong rhythm. It emits `8/5/2026, 6:15:23 PM` — variable width, seconds no
 *     one needs, and it dominates the row it sits in.
 *
 * This renders a real `<time dateTime>` (machine-readable, announced properly),
 * formats deterministically on the server so hydration is clean, then upgrades to
 * the viewer's own timezone after mount. `title` always carries the full precision
 * with an explicit zone, so an auditor can hover and get the unambiguous value.
 */

const UTC_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const UTC_DATETIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

type Precision = 'date' | 'datetime'

function serverFormat(d: Date, precision: Precision): string {
  return precision === 'date' ? UTC_DATE.format(d) : UTC_DATETIME.format(d)
}

function localFormat(d: Date, precision: Precision): string {
  const opts: Intl.DateTimeFormatOptions =
    precision === 'date'
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  // Show the year only when it isn't the current one — keeps dense rows short
  // without ever being ambiguous about older records.
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

function fullFormat(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(d)
}

export function TimeCell({
  value,
  precision = 'datetime',
  className,
  fallback = '—',
}: {
  /** ISO-8601 string from the database, or null. */
  value: string | null | undefined
  precision?: Precision
  className?: string
  fallback?: string
}) {
  const date = React.useMemo(() => (value ? new Date(value) : null), [value])
  const valid = date != null && !Number.isNaN(date.getTime())

  // Two-pass: the first render (server AND client hydration) uses the deterministic
  // UTC format, so the hydration pass matches the server markup exactly; the switch
  // to the viewer's zone happens in the effect, after hydration has committed.
  // `suppressHydrationWarning` below is belt-and-braces for the `title` attribute,
  // not a cover for a mismatched first render.
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  if (!valid) return <Numeric className={cn('text-muted-foreground', className)}>{fallback}</Numeric>

  const text = mounted ? localFormat(date, precision) : serverFormat(date, precision)
  const title = mounted ? fullFormat(date) : `${serverFormat(date, precision)} UTC`

  // Rendered as a bare element rather than via <Numeric>, because Numeric does not
  // forward arbitrary props and `dateTime` is the whole point of the <time> tag.
  // `numeric` is the same design-system class Numeric applies (typography.tsx).
  return (
    <time dateTime={date.toISOString()} title={title} className={cn('numeric whitespace-nowrap', className)} suppressHydrationWarning>
      {text}
    </time>
  )
}
