import type { LucideIcon } from 'lucide-react'
import { MetricCard, type Tone } from '@/components/dashboards/primitives'
import { Numeric, Money } from '@/components/ui/typography'
import { cn } from '@/lib/utils'

// Reusable premium summary strip for a workspace's landing page (Advisor OS
// redesign). It is a thin composition over the CANONICAL KPI tile
// (dashboards/primitives `MetricCard`) — NOT a forked tile (CLAUDE.md §6). Each
// tile is computed from the SAME data the page already loaded (no new query, no
// placeholder) and links to a relevant surface (anti-dead-end). `attention` tiles
// recede to calm (`neutral`) at 0 so a page reads as triage, not a flat readout.
// `security` renders the purple firewall marker — use it only for a
// securities/FFS-managed count, never as decoration.

export type StatAccent = Tone

export interface PageStat {
  label: string
  value: string | number
  hint?: string
  href?: string
  icon: LucideIcon
  accent?: Tone
  /** Render a numeric value as currency via <Money> (respects money.ts). */
  currency?: boolean
}

export function PageStatStrip({ stats, className }: { stats: PageStat[]; className?: string }) {
  if (!stats.length) return null
  return (
    <section aria-label="Summary" className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      {stats.map((s) => {
        const numeric = typeof s.value === 'number'
        const value = s.currency && numeric ? (
          <Money value={s.value as number} />
        ) : numeric ? (
          <Numeric>{(s.value as number).toLocaleString('en-US')}</Numeric>
        ) : (
          s.value
        )
        // An attention tile with nothing waiting recedes to calm.
        const tone: Tone = s.accent === 'attention' && numeric && (s.value as number) === 0 ? 'neutral' : s.accent ?? 'brand'
        return <MetricCard key={s.label} label={s.label} value={value} href={s.href} icon={s.icon} tone={tone} hint={s.hint} valueSize="lg" />
      })}
    </section>
  )
}
