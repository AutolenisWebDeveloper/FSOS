import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

// Reusable premium summary strip for a workspace's landing page (Advisor OS
// redesign). Each tile is computed from the SAME data the page already loaded —
// no new query, no placeholder — and links to a relevant surface (anti-dead-end).
// Attention tiles glow gold only when their value signals work (value > 0), and
// recede to calm at 0, so a page reads as a triage surface, not a flat readout.

export type StatAccent = 'brand' | 'positive' | 'attention' | 'neutral'

export interface PageStat {
  label: string
  value: string | number
  hint?: string
  href?: string
  icon: LucideIcon
  accent?: StatAccent
}

function chipClass(accent: StatAccent, active: boolean): string {
  if (accent === 'attention') return active ? 'bg-gold/15 text-gold-deep' : 'bg-muted text-muted-foreground'
  if (accent === 'positive') return 'bg-status-won/10 text-status-won'
  if (accent === 'neutral') return 'bg-muted text-muted-foreground'
  return 'bg-primary-soft text-primary'
}
function barClass(accent: StatAccent, active: boolean): string {
  if (accent === 'attention') return active ? 'bg-gold' : 'bg-border'
  if (accent === 'positive') return 'bg-status-won'
  if (accent === 'neutral') return 'bg-muted-foreground/40'
  return 'bg-primary'
}

function Tile({ stat }: { stat: PageStat }) {
  const accent = stat.accent ?? 'brand'
  const numeric = typeof stat.value === 'number'
  const active = numeric ? (stat.value as number) > 0 : true
  const Icon = stat.icon
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <MonoLabel className="text-muted-foreground">{stat.label}</MonoLabel>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors', chipClass(accent, active))} aria-hidden>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-semibold tracking-tight text-foreground">
          {numeric ? <Numeric>{(stat.value as number).toLocaleString('en-US')}</Numeric> : stat.value}
        </div>
        {stat.hint ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{stat.hint}</span>
            {stat.href ? <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} aria-hidden /> : null}
          </p>
        ) : null}
      </div>
      <span className={cn('absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-base ease-standard group-hover:scale-x-100', barClass(accent, active))} aria-hidden />
    </>
  )
  const base = 'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 shadow-elev-xs'
  return stat.href ? (
    <Link href={stat.href} className={cn(base, 'transition-all duration-base ease-standard hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  )
}

export function PageStatStrip({ stats, className }: { stats: PageStat[]; className?: string }) {
  if (!stats.length) return null
  return (
    <section aria-label="Summary" className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {stats.map((s) => (
        <Tile key={s.label} stat={s} />
      ))}
    </section>
  )
}
