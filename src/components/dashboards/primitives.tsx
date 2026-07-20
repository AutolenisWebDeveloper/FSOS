import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MonoLabel, Numeric } from '@/components/ui/typography'

/*
 * Production Operations dashboard primitives (Impeccable · Product register).
 *
 * Server-Component-safe building blocks shared by the three command centers
 * (Cross-Sell, Life Win-Back, Life Conversion). No hooks, no client handlers —
 * every widget renders from data the page loaded server-side. Color resolves only
 * through FSOS tokens; numerics are DM Mono tabular; section headers are mono
 * labels. These compose into one unified design language across all three pages.
 */

export type Tone = 'neutral' | 'brand' | 'attention' | 'positive' | 'security' | 'critical'

// Icon-chip tint per tone. Gold ('attention') is reserved for assumptions +
// queues that need action; green ('positive') for won/recovered; purple
// ('security') for the firewall; red ('critical') for blocking/loss.
const CHIP_TONE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border/60',
  brand: 'bg-primary-soft/70 text-primary ring-primary/15',
  attention: 'bg-gold/15 text-gold-deep ring-gold/25',
  positive: 'bg-status-won/12 text-status-won ring-status-won/20',
  security: 'bg-status-security/12 text-status-security ring-status-security/25',
  critical: 'bg-destructive/10 text-destructive ring-destructive/20',
}

const BAR_TONE: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/45',
  brand: 'bg-primary',
  attention: 'bg-gold',
  positive: 'bg-status-won',
  security: 'bg-status-security',
  critical: 'bg-destructive',
}

const ACCENT_TEXT: Record<Tone, string> = {
  neutral: 'text-foreground',
  brand: 'text-primary',
  attention: 'text-gold-deep',
  positive: 'text-status-won',
  security: 'text-status-security',
  critical: 'text-destructive',
}

export function toneBar(tone: Tone) {
  return BAR_TONE[tone]
}
export function toneText(tone: Tone) {
  return ACCENT_TEXT[tone]
}

// ─── Panel: the workhorse titled container ────────────────────────────────────

export function Panel({
  title,
  description,
  icon: Icon,
  action,
  tone = 'neutral',
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  /** Right-aligned action, usually a drill-in link. */
  action?: React.ReactNode
  tone?: Tone
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-card shadow-elev-xs',
        tone === 'attention' && 'border-gold/40',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <span
              aria-hidden
              className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset', CHIP_TONE[tone])}
            >
              <Icon className="h-4 w-4" strokeWidth={1.9} />
            </span>
          ) : null}
          <div className="min-w-0">
            <MonoLabel className={cn('truncate', tone === 'attention' && 'text-gold-deep')}>{title}</MonoLabel>
            {description ? <p className="truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn('flex-1 p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/** A subdued "View all →" style link for panel headers. */
export function PanelLink({ href, children = 'View all' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:text-primary"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

// ─── Delta pill (period-over-period change) ───────────────────────────────────

export function DeltaPill({
  value,
  suffix = '%',
  positiveIsGood = true,
  neutralThreshold = 0,
}: {
  value: number | null | undefined
  suffix?: string
  /** For metrics where a drop is good (e.g. aging), flip the color semantics. */
  positiveIsGood?: boolean
  neutralThreshold?: number
}) {
  if (value == null || Number.isNaN(value)) return null
  const up = value > neutralThreshold
  const down = value < -neutralThreshold
  const good = up ? positiveIsGood : down ? !positiveIsGood : null
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const cls = good === null ? 'text-muted-foreground bg-muted' : good ? 'text-status-won bg-status-won/10' : 'text-destructive bg-destructive/10'
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium', cls)}>
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden />
      <Numeric>
        {up ? '+' : ''}
        {value}
        {suffix}
      </Numeric>
    </span>
  )
}

// ─── Sparkline (tiny SVG trend) ───────────────────────────────────────────────

export function Sparkline({
  data,
  tone = 'brand',
  className,
  width = 96,
  height = 28,
}: {
  data: number[]
  tone?: Tone
  className?: string
  width?: number
  height?: number
}) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = max - min || 1
  const step = width / (data.length - 1)
  const pts = data.map((d, i) => [i * step, height - 2 - ((d - min) / span) * (height - 4)] as const)
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const stroke = toneText(tone)
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={area} className={cn(stroke)} fill="currentColor" fillOpacity={0.08} stroke="none" />
      <path d={line} className={cn(stroke)} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2} className={stroke} fill="currentColor" />
    </svg>
  )
}

// ─── MetricCard: the executive KPI tile ───────────────────────────────────────

export function MetricCard({
  label,
  value,
  href,
  icon: Icon,
  tone = 'neutral',
  hint,
  delta,
  spark,
}: {
  label: string
  value: React.ReactNode
  href?: string
  icon?: LucideIcon
  tone?: Tone
  hint?: React.ReactNode
  delta?: React.ReactNode
  spark?: number[]
}) {
  const card = (
    <div
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-elev-xs',
        tone === 'attention' && 'border-gold/45 bg-gradient-to-b from-gold/[0.06] to-transparent',
        href && 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        href && (tone === 'attention' ? 'hover:border-gold/70' : 'hover:border-primary/40'),
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/60" />
      <div className="flex items-start justify-between gap-2">
        {Icon ? (
          <span aria-hidden className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', CHIP_TONE[tone])}>
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
        {Icon ? <MonoLabel className={cn('truncate', tone === 'attention' && 'text-gold-deep')}>{label}</MonoLabel> : null}
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <Numeric as="div" className={cn('text-[28px] font-semibold leading-none tracking-tight', tone === 'attention' && 'text-gold-deep')}>
            {value}
          </Numeric>
          {spark && spark.length > 1 ? <Sparkline data={spark} tone={tone === 'neutral' ? 'brand' : tone} className="mb-0.5" /> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {delta}
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
    </div>
  )
  if (!href) return card
  return (
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {card}
    </Link>
  )
}

/** Responsive KPI grid. Defaults to a dense executive row. */
export function MetricGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5', className)}>{children}</div>
}

// ─── ProgressMeter (rate against a base) ──────────────────────────────────────

export function ProgressMeter({
  label,
  value,
  total,
  display,
  tone = 'brand',
  hint,
}: {
  label: string
  value: number
  total: number
  /** Override the right-aligned figure (else `value / total`). */
  display?: React.ReactNode
  tone?: Tone
  hint?: string
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-foreground">{label}</span>
        <Numeric className={cn('text-sm font-semibold', toneText(tone))}>{display ?? `${pct}%`}</Numeric>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn('h-full rounded-full transition-all', toneBar(tone))} style={{ width: `${pct}%` }} />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

// ─── MiniStat (inline label/value pair) ───────────────────────────────────────

export function MiniStat({ label, value, tone = 'neutral' }: { label: string; value: React.ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <MonoLabel className="truncate text-[10px]">{label}</MonoLabel>
      <Numeric as="div" className={cn('mt-0.5 text-base font-semibold', toneText(tone))}>
        {value}
      </Numeric>
    </div>
  )
}

// ─── EmptyNote (in-panel empty state) ─────────────────────────────────────────

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[80px] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
