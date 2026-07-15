import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * FSOS Design System typography primitives (docs/design-system.md §2).
 *
 *  • MonoLabel — the SIGNATURE marker: DM Mono, 11px, tracked, uppercase. Use for
 *    every section header, card eyebrow, dashboard tile caption, panel title.
 *  • Numeric   — DM Mono with tabular figures. Wrap EVERY monetary value, policy
 *    number, date, ID, and percentage in it. This is what makes a financial tool
 *    feel like a financial tool.
 *  • Money     — Numeric + USD formatting.
 */

export function MonoLabel({
  children,
  className,
  as: Tag = 'div',
  muted = true,
}: {
  children: React.ReactNode
  className?: string
  as?: React.ElementType
  /** Muted foreground by default; pass false to inherit color (e.g. on the shell). */
  muted?: boolean
}) {
  return (
    <Tag className={cn('mono-label', muted && 'text-muted-foreground', className)}>{children}</Tag>
  )
}

export function Numeric({
  children,
  className,
  as: Tag = 'span',
}: {
  children: React.ReactNode
  className?: string
  as?: React.ElementType
}) {
  return <Tag className={cn('numeric', className)}>{children}</Tag>
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Money rendered in DM Mono, tabular. `cents` shows two decimals; default rounds. */
export function Money({
  value,
  cents = false,
  className,
}: {
  value: number | null | undefined
  cents?: boolean
  className?: string
}) {
  if (value == null || Number.isNaN(value)) return <Numeric className={className}>—</Numeric>
  return <Numeric className={className}>{(cents ? USD_CENTS : USD).format(value)}</Numeric>
}
