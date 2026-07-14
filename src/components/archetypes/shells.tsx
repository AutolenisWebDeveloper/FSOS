import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
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

/** A1 KPI tile — every tile links to its underlying list/detail (no dead ends). */
export function StatTile({
  label,
  value,
  href,
  hint,
}: {
  label: string
  value: React.ReactNode
  href: string
  hint?: string
}) {
  return (
    <Link href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-semibold">{value}</div>
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </CardContent>
      </Card>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
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
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2" aria-label={title}>
      <div className="flex items-center justify-between px-1 text-sm font-medium">
        <span>{title}</span>
        {typeof count === 'number' ? <span className="text-muted-foreground">{count}</span> : null}
      </div>
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
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              i === current
                ? 'border-primary bg-primary/10 text-primary'
                : i < current
                  ? 'border-status-won/40 text-status-won'
                  : 'text-muted-foreground',
            )}
          >
            <span className="font-medium">{i + 1}</span>
            {s}
          </li>
        ))}
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
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">{title}</CardTitle>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        {footer ? <div className="border-t p-4 text-center text-sm text-muted-foreground">{footer}</div> : null}
      </Card>
    </main>
  )
}
