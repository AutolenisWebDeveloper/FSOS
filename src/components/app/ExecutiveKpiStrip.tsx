import Link from 'next/link'
import { Wallet, TrendingUp, Target, Building2, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Money, Numeric, MonoLabel } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { WidgetValue } from '@/lib/analytics/metrics'

// Executive KPI hero (Advisor OS redesign, reference workspace). A premium 4-up
// headline strip rendered from the SAME live widget values the dashboard grid
// uses (lib/analytics/metrics) — no new query, no placeholder. Each tile links to
// its source records (anti-dead-end, per the A1 rule) and degrades to a labeled
// "—" when its metric fails to load, so the strip never blanks.

const FEATURED: { key: string; icon: LucideIcon; accent: 'brand' | 'positive' }[] = [
  { key: 'commission_ytd', icon: Wallet, accent: 'positive' },
  { key: 'weighted_pipeline', icon: TrendingUp, accent: 'brand' },
  { key: 'open_opportunities', icon: Target, accent: 'brand' },
  { key: 'agency_partnerships', icon: Building2, accent: 'brand' },
]

function KpiTile({ v, icon: Icon, accent }: { v: WidgetValue; icon: LucideIcon; accent: 'brand' | 'positive' }) {
  const failed = v.value === null
  return (
    <Link
      href={v.href}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 shadow-elev-xs transition-all duration-base ease-standard hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <MonoLabel className="text-muted-foreground">{v.label}</MonoLabel>
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
            accent === 'positive' ? 'bg-status-won/10 text-status-won' : 'bg-primary-soft text-primary',
          )}
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
      </div>
      <div className="mt-4">
        <div className="text-2xl font-semibold tracking-tight text-foreground">
          {failed ? (
            <span className="text-muted-foreground" aria-label="Metric unavailable">—</span>
          ) : v.kind === 'currency' ? (
            <Money value={v.value} />
          ) : (
            <Numeric>{(v.value ?? 0).toLocaleString('en-US')}</Numeric>
          )}
        </div>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{failed ? "Couldn't load — open to retry" : v.hint ?? 'View records'}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={2} aria-hidden />
        </p>
      </div>
      {/* Bottom accent hairline that fills on hover — a quiet premium tell. */}
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-base ease-standard group-hover:scale-x-100',
          accent === 'positive' ? 'bg-status-won' : 'bg-primary',
        )}
        aria-hidden
      />
    </Link>
  )
}

export function ExecutiveKpiStrip({ widgets }: { widgets: WidgetValue[] }) {
  const byKey = new Map(widgets.map((w) => [w.key, w]))
  const tiles = FEATURED.map((f) => ({ ...f, v: byKey.get(f.key) })).filter(
    (t): t is typeof t & { v: WidgetValue } => Boolean(t.v),
  )
  if (!tiles.length) return null
  return (
    <section aria-label="Headline metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <KpiTile key={t.key} v={t.v} icon={t.icon} accent={t.accent} />
      ))}
    </section>
  )
}
