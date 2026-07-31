import Link from 'next/link'
import { ChevronRight, CheckCircle2 } from 'lucide-react'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { PriorityItem, Severity } from '@/lib/dashboards/executive'

// Needs Immediate Attention — the ranked triage rail. Real signals only, zeros
// dropped upstream; a genuinely clear queue shows a calm, earned empty state
// rather than filler.

const SEV: Record<Severity, { label: string; className: string }> = {
  high: { label: 'High', className: 'text-destructive' },
  medium: { label: 'Medium', className: 'text-gold-deep' },
  low: { label: 'Low', className: 'text-status-won' },
}

export function PriorityQueue({ items }: { items: PriorityItem[] }) {
  return (
    <section aria-label="Needs immediate attention" className="flex flex-col rounded-2xl border border-border bg-card shadow-elev-xs">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <MonoLabel className="text-muted-foreground">Needs immediate attention</MonoLabel>
        {items.length > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground" aria-label={`${items.length} alert${items.length === 1 ? '' : 's'}`}>
            {items.length}
          </span>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-status-won" strokeWidth={1.75} aria-hidden />
          <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
          <p className="max-w-[24ch] text-xs text-muted-foreground">Nothing needs action right now. A good time to advance your pipeline.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const sev = SEV[item.severity]
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Numeric as="span" className="w-8 shrink-0 text-lg font-semibold tabular-nums text-foreground">{item.count.toLocaleString('en-US')}</Numeric>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.note}</p>
                  </div>
                  <span className={cn('shrink-0 text-xs font-semibold', sev.className)}>{sev.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={2} aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        href="/app/executive/alerts"
        className="mt-auto border-t border-border px-4 py-2.5 text-center text-sm font-medium text-primary transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        View all alerts
      </Link>
    </section>
  )
}
