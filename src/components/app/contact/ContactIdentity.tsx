import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyValue } from './ContactHeaderActions'

/*
 * The identity band — a single dark, full-bleed lockup that answers WHO and
 * WHAT STATE before the FSA scrolls anything.
 *
 * Three tiers, deliberately in this order:
 *   1. utility row — breadcrumb left, the action cluster right, so the actions
 *      never squeeze the name;
 *   2. identity     — monogram, name, state chips, one-line role/company/place;
 *   3. facts        — a hairline-separated run of the identity attributes.
 *
 * The facts run is NOT a card grid. Each fact sizes to its own content and wraps,
 * so eight attributes read as one strip instead of eight boxes, and nothing is
 * clipped to an arbitrary column width.
 */

export function IdentityBand({
  breadcrumb,
  monogram,
  name,
  chips,
  subtitle,
  actions,
  facts,
}: {
  breadcrumb: { label: string; href?: string }[]
  monogram: string
  name: string
  chips?: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  facts: React.ReactNode
}) {
  return (
    <div className="shell-gradient shell-hairline -mx-4 -mt-6 border-b border-shell-border px-4 pb-3 pt-4 text-shell-foreground shadow-elev-md md:-mx-6 md:px-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px] text-shell-muted">
            {breadcrumb.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden /> : null}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="shrink-0 rounded-sm transition-colors hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="truncate text-shell-foreground">{item.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
          {actions ? <div className="min-w-0">{actions}</div> : null}
        </div>

        <div className="mt-3.5 flex items-start gap-3.5 sm:gap-4">
          <span
            aria-hidden
            className="brand-fill mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold tracking-wide text-primary-foreground ring-1 ring-inset ring-white/15 sm:h-[52px] sm:w-[52px] sm:text-lg"
          >
            {monogram}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight sm:text-[27px]">{name}</h1>
              {chips}
            </div>
            {subtitle ? <div className="text-sm text-shell-muted">{subtitle}</div> : null}
          </div>
        </div>

        <dl className="mt-3.5 flex flex-wrap items-start gap-y-3 border-t border-shell-border/70 pt-3">{facts}</dl>
      </div>
    </div>
  )
}

/**
 * One identity fact. Hairline-separated and content-sized rather than boxed, so a
 * row of facts reads as a single strip. `copy` adds the inline clipboard control,
 * revealed on hover or keyboard focus.
 */
export function Fact({
  label,
  value,
  title,
  href,
  copy,
  mono,
  tone = 'default',
  wide,
}: {
  label: string
  value: React.ReactNode
  /** Native tooltip for a value that may truncate. */
  title?: string
  href?: string | null
  copy?: { value: string; what: string } | null
  mono?: boolean
  tone?: 'default' | 'attention'
  /** Give a long value (an email) more room before it truncates. */
  wide?: boolean
}) {
  const isEmpty = value == null || value === ''
  const body = (
    <span
      className={cn(
        'block truncate text-[13px] leading-snug',
        mono && 'numeric',
        isEmpty ? 'text-shell-muted/70' : tone === 'attention' ? 'text-gold' : 'text-shell-foreground',
        href && 'underline-offset-2 group-hover/fact:underline',
      )}
    >
      {isEmpty ? '—' : value}
    </span>
  )
  return (
    <div
      className={cn(
        'group/fact min-w-0 border-l border-shell-border/60 pl-3.5 pr-4 first:border-l-0 first:pl-0',
        wide ? 'max-w-[27rem] flex-1 basis-[15rem]' : 'max-w-[15rem]',
      )}
    >
      <dt className="mono-label truncate text-[10px] text-shell-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1" title={title}>
        {href && !isEmpty ? (
          <Link
            href={href}
            className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {body}
          </Link>
        ) : (
          <span className="min-w-0 flex-1">{body}</span>
        )}
        {copy && !isEmpty ? <CopyValue value={copy.value} what={copy.what} /> : null}
      </dd>
    </div>
  )
}
