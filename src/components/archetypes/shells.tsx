import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, ArrowUpRight, Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import { BrandMark } from '@/components/portal/BrandMark'

/*
 * Presentational archetype shells (archetypes.md). Server-component-safe (no
 * hooks): each renders the required structure + named slots and lets the page
 * supply real data and the empty/loading/error/success states from states.tsx.
 * Interactive archetypes (A7 modal, A8 drawer, A9 confirm) live in overlays.tsx.
 */

// ─── Breadcrumb + PageHeader (shared chrome) ──────────────────────────────────

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string
  description?: string
  breadcrumb?: { label: string; href?: string }[]
  actions?: React.ReactNode
}) {
  return (
    <header className="space-y-2">
      {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

// ─── Section band (dashboard / page hierarchy) ────────────────────────────────

/**
 * A titled content band — the unit of hierarchy on dense operator screens. A mono
 * eyebrow (the signature marker) + optional secondary text and a right-aligned
 * action link, over its children. Use it to group a home screen or long page into
 * scannable bands (Triage · Book · Pipeline · Commissions · Compliance) instead of
 * one flat wall of tiles.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <MonoLabel>{title}</MonoLabel>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

// ─── A1 Dashboard / Command Center ────────────────────────────────────────────

export function DashboardShell({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  )
}

/**
 * A1 executive KPI tile — an icon-anchored metric card: glyph chip, mono label,
 * a prominent tabular value, and optional supporting context. Every interactive
 * tile links to its underlying list/detail (no dead ends) and lifts on hover.
 * `tone` tints the icon chip: `brand` for money/production, `attention` (gold)
 * for queues that need action, `neutral` for inventory counts.
 */
export function StatTile({
  label,
  value,
  href,
  hint,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string
  value: React.ReactNode
  /** Optional — omit for a summary tile that isn't a link. */
  href?: string
  hint?: string
  icon?: LucideIcon
  tone?: 'neutral' | 'brand' | 'attention'
}) {
  const card = (
    <Card
      className={cn(
        'group relative flex h-full flex-col overflow-hidden p-4',
        tone === 'attention' && 'border-gold/45 bg-gradient-to-b from-gold/[0.07] to-transparent',
        href && 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        href && (tone === 'attention' ? 'hover:border-gold/70' : 'hover:border-primary/40'),
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/60" />
      <div className="flex items-start justify-between gap-2">
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              tone === 'attention'
                ? 'bg-gold/15 text-gold-deep ring-gold/25'
                : tone === 'brand'
                  ? 'bg-primary-soft/70 text-primary ring-primary/15'
                  : 'bg-muted text-muted-foreground ring-border/60',
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
        ) : (
          <MonoLabel className={cn(tone === 'attention' && 'text-gold-deep')}>{label}</MonoLabel>
        )}
        {href ? (
          <ArrowUpRight
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground/40 opacity-0 transition-all duration-200 group-hover:opacity-100',
              tone === 'attention' ? 'group-hover:text-gold-deep' : 'group-hover:text-primary',
            )}
            aria-hidden
          />
        ) : null}
      </div>
      <div className={cn(Icon ? 'mt-3' : 'mt-2')}>
        {Icon ? (
          <MonoLabel className={cn('truncate', tone === 'attention' && 'text-gold-deep')}>{label}</MonoLabel>
        ) : null}
        <Numeric
          as="div"
          className={cn('mt-1.5 text-[30px] font-semibold leading-none tracking-tight', tone === 'attention' && 'text-gold-deep')}
        >
          {value}
        </Numeric>
        {hint ? <p className="mt-2 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  )
  if (!href) return card
  return (
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {card}
    </Link>
  )
}

// ─── A2 List / Index ──────────────────────────────────────────────────────────

export function ListShell({
  title,
  description,
  breadcrumb,
  actions,
  toolbar,
  children,
}: {
  title: string
  description?: string
  breadcrumb?: { label: string; href?: string }[]
  actions?: React.ReactNode
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} breadcrumb={breadcrumb} actions={actions} />
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
      <div>{children}</div>
    </div>
  )
}

// ─── A3 Detail / Record ───────────────────────────────────────────────────────

export function DetailShell({
  title,
  description,
  breadcrumb,
  status,
  actions,
  rail,
  children,
}: {
  title: string
  description?: string
  breadcrumb?: { label: string; href?: string }[]
  status?: React.ReactNode
  actions?: React.ReactNode
  /** Related-records rail (anti-dead-end link set). */
  rail?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      {/* Dark-tinted header band (design-system.md A3): status chips + primary actions. */}
      <div className="shell-gradient -mx-4 -mt-6 mb-2 border-b border-shell-border px-4 py-5 text-shell-foreground shadow-elev-sm md:-mx-6 md:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            {breadcrumb ? (
              <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-shell-muted">
                {breadcrumb.map((item, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : null}
                    {item.href ? (
                      <Link href={item.href} className="hover:text-shell-foreground">
                        {item.label}
                      </Link>
                    ) : (
                      <span className="text-shell-foreground">{item.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {status}
            </div>
            {description ? <p className="text-sm text-shell-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">{children}</div>
        {rail ? <aside className="space-y-4 lg:border-l lg:pl-6">{rail}</aside> : null}
      </div>
    </div>
  )
}

// ─── A4 Kanban / Board ────────────────────────────────────────────────────────

export function BoardShell({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
    </div>
  )
}

export function BoardColumn({
  title,
  count,
  total,
  children,
}: {
  title: string
  count?: number
  /** Aggregate value shown in DM Mono under the column header (design-system.md A4). */
  total?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2 px-1">
        <MonoLabel className="text-foreground">{title}</MonoLabel>
        {typeof count === 'number' ? <Numeric className="text-xs text-muted-foreground">{count}</Numeric> : null}
      </div>
      {total != null ? <Numeric className="px-1 text-xs text-muted-foreground">{total}</Numeric> : null}
      <div className="space-y-2">{children}</div>
    </section>
  )
}

// ─── A5 Form / Create-Edit ────────────────────────────────────────────────────

export function FormShell({
  title,
  description,
  breadcrumb,
  onSubmitNote,
  footer,
  children,
}: {
  title: string
  description?: string
  breadcrumb?: { label: string; href?: string }[]
  /** Reminder that Zod is the source of truth (client + server). */
  onSubmitNote?: string
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={title} description={description} breadcrumb={breadcrumb} />
      <Card>
        <CardContent className="space-y-4 pt-6">{children}</CardContent>
        {footer ? <div className="flex items-center justify-end gap-2 border-t p-4">{footer}</div> : null}
      </Card>
      {onSubmitNote ? <p className="text-xs text-muted-foreground">{onSubmitNote}</p> : null}
    </div>
  )
}

// ─── A6 Wizard / Multi-step ───────────────────────────────────────────────────

export function WizardShell({
  title,
  steps,
  current,
  children,
  footer,
}: {
  title: string
  steps: string[]
  current: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={title} />
      <ol className="flex flex-wrap gap-2" aria-label="Progress">
        {steps.map((s, i) => {
          const done = i < current
          const currentStep = i === current
          // State is carried by an icon + sr-only word, not color alone (WCAG 2.2
          // AA · SC 1.4.1): completed steps show a check, the current step a filled
          // number chip, upcoming steps an outline number.
          return (
            <li
              key={s}
              aria-current={currentStep ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
                currentStep
                  ? 'border-primary bg-primary/10 text-primary'
                  : done
                    ? 'border-status-won/40 text-status-won'
                    : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                  currentStep
                    ? 'bg-primary text-primary-foreground'
                    : done
                      ? 'bg-status-won text-white'
                      : 'border border-current',
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="sr-only">{done ? 'Completed: ' : currentStep ? 'Current step: ' : 'Upcoming: '}</span>
              {s}
            </li>
          )
        })}
      </ol>
      <Card>
        <CardContent className="space-y-4 pt-6">{children}</CardContent>
        {footer ? <div className="flex items-center justify-between border-t p-4">{footer}</div> : null}
      </Card>
    </div>
  )
}

// ─── A10 Settings / Configuration ─────────────────────────────────────────────

export function SettingsShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={title} description={description} />
      <div className="space-y-6">{children}</div>
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

// ─── A11 Report / Analytics ───────────────────────────────────────────────────

export function ReportShell({
  title,
  description,
  filters,
  actions,
  children,
}: {
  title: string
  description?: string
  filters?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} actions={actions} />
      {filters ? <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">{filters}</div> : null}
      <div className="space-y-4">{children}</div>
    </div>
  )
}

// ─── A12 Integration / Connection ─────────────────────────────────────────────

type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'degraded'

const INTEGRATION_STATUS_STYLE: Record<IntegrationStatus, string> = {
  connected: 'text-status-won',
  disconnected: 'text-muted-foreground',
  error: 'text-status-blocked',
  degraded: 'text-status-pending',
}

export function IntegrationShell({
  name,
  status,
  lastSync,
  actions,
  fallbackNote,
  children,
}: {
  name: string
  status: IntegrationStatus
  lastSync?: string
  actions?: React.ReactNode
  /** Shown when no verified API exists — the labeled manual/CSV placeholder (§2.3). */
  fallbackNote?: string
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{name}</CardTitle>
          <span className={cn('text-xs font-medium capitalize', INTEGRATION_STATUS_STYLE[status])}>{status}</span>
        </div>
        {lastSync ? <p className="text-xs text-muted-foreground">Last sync: {lastSync}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        {fallbackNote ? (
          <p className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-2 text-xs text-status-assumption">
            {fallbackNote}
          </p>
        ) : null}
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </CardContent>
    </Card>
  )
}

// ─── A13 Auth / System ────────────────────────────────────────────────────────

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-shell p-4 text-shell-foreground">
      {/* Branded navy backdrop with a soft radial brand glow. */}
      <div className="shell-gradient absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(60rem 40rem at 50% -10%, hsl(var(--accent) / 0.16), transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-sm space-y-6">
        {/* Identity lockup above the card. */}
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark size="lg" />
          <div className="mono-label text-shell-muted">FSA Command Center</div>
        </div>
        <Card className="w-full shadow-elev-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-lg">{title}</CardTitle>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
          {footer ? <div className="border-t p-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
        </Card>
      </div>
    </main>
  )
}
