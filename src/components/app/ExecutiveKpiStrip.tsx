import { Wallet, TrendingUp, Target, Building2, type LucideIcon } from 'lucide-react'
import { Money, Numeric } from '@/components/ui/typography'
import { MetricCard, type Tone } from '@/components/dashboards/primitives'
import type { WidgetValue } from '@/lib/analytics/metrics'

// Executive KPI hero (Advisor OS redesign, reference workspace). A premium 4-up
// headline rendered from the SAME live widget values the dashboard grid uses
// (lib/analytics/metrics) — no new query, no placeholder. Each tile is the
// CANONICAL KPI tile (dashboards/primitives `MetricCard`, not a forked tile —
// CLAUDE.md §6), links to its source records, and degrades to a labeled "—" when
// its metric fails to load, so the strip never blanks.

const FEATURED: { key: string; icon: LucideIcon; tone: Tone }[] = [
  { key: 'commission_ytd', icon: Wallet, tone: 'positive' },
  { key: 'weighted_pipeline', icon: TrendingUp, tone: 'brand' },
  { key: 'open_opportunities', icon: Target, tone: 'brand' },
  { key: 'agency_partnerships', icon: Building2, tone: 'brand' },
]

export function ExecutiveKpiStrip({ widgets }: { widgets: WidgetValue[] }) {
  const byKey = new Map(widgets.map((w) => [w.key, w]))
  const tiles = FEATURED.map((f) => ({ ...f, v: byKey.get(f.key) })).filter(
    (t): t is typeof t & { v: WidgetValue } => Boolean(t.v),
  )
  if (!tiles.length) return null
  return (
    <section aria-label="Headline metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(({ key, icon, tone, v }) => {
        const failed = v.value === null
        const value = failed ? (
          <span className="text-muted-foreground" aria-label="Metric unavailable">—</span>
        ) : v.kind === 'currency' ? (
          <Money value={v.value} />
        ) : (
          <Numeric>{(v.value ?? 0).toLocaleString('en-US')}</Numeric>
        )
        return (
          <MetricCard
            key={key}
            label={v.label}
            value={value}
            href={v.href}
            icon={icon}
            tone={failed ? 'neutral' : tone}
            hint={failed ? "Couldn't load — open to retry" : v.hint ?? 'View records'}
            valueSize="lg"
          />
        )
      })}
    </section>
  )
}
