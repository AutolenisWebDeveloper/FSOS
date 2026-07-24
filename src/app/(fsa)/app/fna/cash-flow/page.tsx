import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { loadModuleResults } from '@/lib/fna/module-results'
import { ConfidenceBadge, fmtMoney, fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Cash-flow module (build instruction §8). Reads the latest calculated cash-flow
// result from each plan's current version — income vs. expenses, surplus/deficit,
// savings rate. Every figure is Calculated (deterministic engine). Roles: fsa.
export default async function FnaCashFlowPage() {
  await requireRole('fsa', '/app/fna/cash-flow')
  const res = await loadModuleResults('cash_flow')

  const header = (
    <PageHeader
      title="Cash flow"
      description="Income vs. expenses, surplus/deficit, and savings rate — the latest calculated figure per plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Cash flow' }]}
      actions={
        <Button asChild>
          <Link href="/app/fna/plans/new">Start a plan</Link>
        </Button>
      }
    />
  )

  if (!res.ok) {
    return (
      <div className="space-y-6">
        {header}
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      {res.data.length === 0 ? (
        <EmptyState title="No calculated cash flow yet" description="Start a plan, enter income and expenses, and calculate to see surplus/deficit here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((m) => {
            const o = m.envelope.output as { monthlySurplus?: number; annualSurplus?: number; savingsRate?: number; isDeficit?: boolean } | undefined
            return (
              <Link key={m.planId} href={`/app/fna/plans/${m.planId}/results`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{m.householdName}</p>
                      <ConfidenceBadge confidence={m.confidence as 'high' | 'medium' | 'low'} />
                    </div>
                    <p className={`text-2xl font-semibold tabular-nums ${o?.isDeficit ? 'text-destructive' : ''}`}>{fmtMoney(o?.monthlySurplus)}/mo</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtMoney(o?.annualSurplus)}/yr · savings rate {fmtPercent(o?.savingsRate)} · v{m.versionNo}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
