import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MonoLabel } from '@/components/ui/typography'
import type { AttentionItem, AttentionTone, ContactRecordSection } from '@/lib/contacts/record-view'
import { CONTACT_RECORD_SECTIONS } from '@/lib/contacts/record-view'

/*
 * Page chrome for the Contact Record: the attention strip, the section nav, and
 * the two band primitives (Panel / RailBand) that every section composes from.
 *
 * The band primitives exist so the record does NOT become a grid of identical
 * rounded rectangles. A Panel is a titled region on the canvas with a mono
 * eyebrow and a hairline rule — no border, no shadow. Only genuinely tabular or
 * genuinely list-like content gets a bordered surface, and the rail is ONE
 * bordered object internally divided into bands.
 */

// ─── Attention ────────────────────────────────────────────────────────────────

const TONE: Record<AttentionTone, { wrap: string; icon: React.ComponentType<{ className?: string }>; dot: string }> = {
  critical: { wrap: 'border-status-lost/35 bg-status-lost/[0.07]', icon: TriangleAlert, dot: 'text-status-lost' },
  warning: { wrap: 'border-status-pending/40 bg-status-pending/[0.08]', icon: AlertTriangle, dot: 'text-status-pending' },
  info: { wrap: 'border-border bg-muted/40', icon: Info, dot: 'text-muted-foreground' },
}

export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null
  const lead = items[0]

  return (
    <section
      aria-label="Needs attention"
      className={cn('overflow-hidden rounded-xl border', TONE[lead.tone].wrap)}
    >
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const t = TONE[item.tone]
          const Icon = t.icon
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
              <Icon className={cn('h-4 w-4 shrink-0', t.dot)} aria-hidden />
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.label}</span>
              <Link
                href={item.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-primary underline-offset-2 transition-colors hover:bg-primary-soft/60 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
      <span className="sr-only">
        {items.length} {items.length === 1 ? 'item needs' : 'items need'} attention. Most urgent: {lead.label}.
      </span>
    </section>
  )
}

// ─── Section nav ──────────────────────────────────────────────────────────────

export function ContactSectionNav({
  contactId,
  active,
  counts,
}: {
  contactId: string
  active: ContactRecordSection
  counts: Partial<Record<ContactRecordSection, number>>
}) {
  return (
    <nav
      aria-label="Contact sections"
      className="relative -mx-4 border-b px-4 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-full gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CONTACT_RECORD_SECTIONS.map((s) => {
          const isActive = s.id === active
          const count = counts[s.id]
          return (
            <li key={s.id}>
              <Link
                href={s.id === 'overview' ? `/app/contacts/${contactId}` : `/app/contacts/${contactId}?s=${s.id}`}
                aria-current={isActive ? 'page' : undefined}
                scroll={false}
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap px-2.5 py-2.5 text-sm transition-colors duration-fast',
                  'after:absolute after:inset-x-1.5 after:-bottom-px after:h-[2px] after:rounded-full after:transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  isActive
                    ? 'font-semibold text-primary after:bg-primary'
                    : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border',
                )}
              >
                {s.label}
                {count ? (
                  <span
                    className={cn(
                      'numeric rounded-full px-1.5 py-px text-[11px] leading-4',
                      isActive ? 'bg-primary-soft text-primary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ─── Band primitives ──────────────────────────────────────────────────────────

/** A titled region on the canvas — eyebrow + hairline + content. Not a card. */
export function Panel({
  title,
  hint,
  action,
  children,
  className,
  id,
}: {
  title: string
  hint?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} aria-label={title} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <MonoLabel as="h2" className="text-foreground">
            {title}
          </MonoLabel>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A bordered surface for tabular / list content that benefits from containment. */
export function Surface({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-xl border bg-card shadow-elev-xs', className)}>{children}</div>
}

/** One band inside the single bordered rail object. */
export function RailBand({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} className={cn('px-3.5 py-3', className)}>
      {title ? (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <MonoLabel as="h2" className="text-[10px]">
            {title}
          </MonoLabel>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

/**
 * A compact, in-panel empty state. The full EmptyState block is right for a
 * section page; inside an Overview panel it dominates the fold, so a sparse
 * record reads as three big dashed boxes. This is the quiet variant.
 */
export function Nothing({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-dashed bg-muted/25 px-4 py-3.5">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** A compact label/value line used across the rail and the profile section. */
export function DataRow({
  label,
  value,
  mono,
  href,
}: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  href?: string | null
}) {
  const empty = value == null || value === ''
  const content = (
    <span className={cn('min-w-0 text-right text-[13px]', mono && 'numeric', empty ? 'text-muted-foreground/70' : 'text-foreground')}>
      {empty ? '—' : value}
    </span>
  )
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      {href && !empty ? (
        <Link href={href} className="min-w-0 text-right text-primary underline-offset-2 hover:underline">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  )
}
