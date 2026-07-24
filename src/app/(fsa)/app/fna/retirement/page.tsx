import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { loadModuleResults } from '@/lib/fna/module-results'
import { fmtMoney, fmtPercent, ConfidenceBadge } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Retirement module (build instruction §6/§8). Readiness from the latest calculated
// retirement projection per plan — projected savings vs. capital needed, shortfall/
// surplus, funded ratio. Social Security is a labeled assumption unless supplied.
// Analysis only. Scenarios live on the plan. Roles: fsa.
export default async function FnaRetirementPage() {
  await requireRole('fsa', '/app/fna/retirement')
  const res = await loadModuleResults('retirement_projection')

  const header = (
    <PageHeader
      title="Retirement"
      description="Projected savings vs. the capital needed to fund retirement — readiness, shortfall or surplus, and funded ratio per plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Retirement' }]}
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
        <EmptyState title="No retirement projections yet" description="Start a Comprehensive plan, enter age and retirement goals, and calculate to see readiness here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((m) => {
            const o = m.envelope.output as
              | { onTrack?: boolean; shortfall?: number; surplus?: number; projectedSavingsAtRetirement?: number; capitalNeededAtRetirement?: number; fundedRatio?: number; yearsToRetirement?: number }
              | undefined
            return (
              <Link key={m.planId} href={`/app/fna/plans/${m.planId}/scenarios`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{m.householdName}</p>
                      {o?.onTrack ? <Badge variant="active">On track</Badge> : <Badge variant="destructive">Gap</Badge>}
                    </div>
                    <p className={`text-2xl font-semibold tabular-nums ${o?.onTrack ? 'text-status-active' : 'text-destructive'}`}>
                      {o?.onTrack ? `${fmtMoney(o?.surplus)} surplus` : `${fmtMoney(o?.shortfall)} short`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      projected {fmtMoney(o?.projectedSavingsAtRetirement)} / needed {fmtMoney(o?.capitalNeededAtRetirement)} · funded {fmtPercent(o?.fundedRatio, 0)}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <ConfidenceBadge confidence={m.confidence as 'high' | 'medium' | 'low'} />
                      {typeof o?.yearsToRetirement === 'number' ? <span className="text-xs text-muted-foreground">{o.yearsToRetirement} yrs to retirement</span> : null}
                    </div>
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
