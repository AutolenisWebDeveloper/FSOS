import Link from 'next/link'
import { Sparkles, ArrowRight, Target, Shuffle, Repeat, ShieldCheck, type LucideIcon } from 'lucide-react'
import { MonoLabel, Money, Numeric } from '@/components/ui/typography'
import type { ExecutiveDashboard } from '@/lib/dashboards/executive'

// AI Executive Briefing — the dashboard's lede. Every figure is a real signal
// (lib/dashboards/executive), and the summary sentence is composed from those
// counts, never asserted. Restrained AI treatment: the indigo wash + Sparkles
// mark, no decorative orbital chrome (impeccable — decoration must earn its place).

interface Stat {
  icon: LucideIcon
  value: number
  label: string
  sub?: React.ReactNode
  href: string
  accent: 'brand' | 'security'
}

function summarize(b: ExecutiveDashboard['briefing'], priorityCount: number): string {
  if (priorityCount === 0 && b.openOpps === 0) return 'Your book is quiet today — a good window to prospect and deepen relationships.'
  if (priorityCount === 0) return 'Nothing is overdue. Focus on advancing your open pipeline and cross-sell gaps.'
  const parts: string[] = []
  if (b.escalations > 0) parts.push(`${b.escalations} compliance review${b.escalations === 1 ? '' : 's'}`)
  if (b.conversionsDue > 0) parts.push(`${b.conversionsDue} closing conversion window${b.conversionsDue === 1 ? '' : 's'}`)
  if (b.crossSell > 0) parts.push(`${b.crossSell} cross-sell gap${b.crossSell === 1 ? '' : 's'}`)
  const lead = parts.slice(0, 2).join(' and ')
  return lead ? `Start with ${lead} — they move production the most today.` : 'A few items need your attention. Work the priority queue on the right first.'
}

export function BriefingHero({ briefing, priorityCount }: { briefing: ExecutiveDashboard['briefing']; priorityCount: number }) {
  const stats: Stat[] = [
    { icon: Target, value: briefing.openOpps, label: 'High-intent opportunities', sub: briefing.expectedOpen > 0 ? <><Money value={briefing.expectedOpen} /> potential</> : undefined, href: '/app/opportunities/board', accent: 'brand' },
    { icon: Shuffle, value: briefing.crossSell, label: 'Households with cross-sell gaps', href: '/app/cross-sell/household-gaps', accent: 'brand' },
    { icon: Repeat, value: briefing.conversionsDue, label: 'Conversion windows ≤30d', href: '/app/conversions/eligible?tier=30', accent: 'brand' },
    { icon: ShieldCheck, value: briefing.escalations, label: 'Compliance reviews for you', href: '/app/ai/escalations', accent: 'security' },
  ]
  return (
    <section aria-label="AI executive briefing" className="ai-gradient relative overflow-hidden rounded-2xl border border-ai-border bg-card p-5 shadow-elev-sm md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="ai-shell flex h-8 w-8 items-center justify-center rounded-lg text-ai-foreground" aria-hidden>
            <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <MonoLabel className="text-ai-surface-foreground">AI Executive Briefing</MonoLabel>
        </div>
        <Link
          href="/app/executive/briefing"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-ai-border bg-card/70 px-3 py-1.5 text-sm font-medium text-ai-surface-foreground transition-colors duration-fast hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Review full briefing
          <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
        </Link>
      </div>

      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-foreground">{summarize(briefing, priorityCount)}</p>

      {/* Borderless inline stats (no nested cards); dividers on wide viewports. */}
      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4 lg:divide-x lg:divide-border/60">
        {stats.map((s, i) => {
          const Icon = s.icon
          return (
            <Link
              key={s.label}
              href={s.href}
              className={`group flex items-start gap-3 rounded-lg transition-opacity duration-fast hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${i > 0 ? 'lg:pl-4' : ''}`}
            >
              <span className={s.accent === 'security' ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-security/12 text-status-security' : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary'} aria-hidden>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <Numeric as="div" className="text-2xl font-semibold leading-none tracking-tight text-foreground">{s.value.toLocaleString('en-US')}</Numeric>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{s.label}</p>
                {s.sub ? <p className="mt-0.5 text-xs font-medium text-foreground">{s.sub}</p> : null}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
