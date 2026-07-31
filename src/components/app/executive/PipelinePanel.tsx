import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { FunnelChart } from '@/components/dashboards/charts'
import { MonoLabel, Money, Numeric } from '@/components/ui/typography'
import { EmptyNote } from '@/components/dashboards/primitives'
import type { ExecutiveDashboard } from '@/lib/dashboards/executive'

// Pipeline health — the real conversion funnel (monotonic at/past-stage counts)
// rendered with the token-colored server FunnelChart, plus the live revenue
// roll-up. No fabricated stage numbers; an empty book shows the chart's own note.

export function PipelinePanel({ funnel, revenue }: { funnel: ExecutiveDashboard['funnel']; revenue: ExecutiveDashboard['revenue'] }) {
  const hasData = funnel.some((f) => f.value > 0)
  return (
    <section aria-label="Pipeline overview" className="flex flex-col rounded-2xl border border-border bg-card shadow-elev-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <MonoLabel className="text-muted-foreground">Pipeline overview</MonoLabel>
        <Link
          href="/app/opportunities/board"
          className="group inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors duration-fast hover:text-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Board
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
        </Link>
      </header>

      <div className="flex-1 p-4">
        {hasData ? (
          <FunnelChart stages={funnel.map((f) => ({ label: f.label, value: f.value, href: f.href, tone: 'brand' }))} valueLabel="opportunities" />
        ) : (
          <EmptyNote>No open pipeline yet — convert a referral or open an opportunity to see the funnel.</EmptyNote>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <Link href="/app/forecasts" className="group flex flex-col bg-card px-4 py-3 transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <dt className="text-xs text-muted-foreground">Open expected commission</dt>
          <dd className="mt-0.5 text-lg font-semibold text-foreground"><Money value={revenue.expectedOpen} /></dd>
        </Link>
        <Link href="/app/commissions/received" className="group flex flex-col bg-card px-4 py-3 transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <dt className="text-xs text-muted-foreground">Won this book <Numeric as="span" className="text-muted-foreground/80">({revenue.wonCount})</Numeric></dt>
          <dd className="mt-0.5 text-lg font-semibold text-status-won"><Money value={revenue.actualWon} /></dd>
        </Link>
      </dl>
    </section>
  )
}
