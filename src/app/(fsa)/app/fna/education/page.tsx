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

// Education module (build instruction §6/§8). Per-plan education funding need vs.
// projected savings — projected cost with education inflation, capital needed at
// matriculation, and shortfall. Analysis only; scenarios (fund more / lower-cost /
// delay) live on the plan. Roles: fsa.
export default async function FnaEducationPage() {
  await requireRole('fsa', '/app/fna/education')
  const res = await loadModuleResults('education_funding')

  const header = (
    <PageHeader
      title="Education"
      description="College funding need vs. projected savings — cost inflated to matriculation, capital needed, and any shortfall per plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Education' }]}
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
        <EmptyState title="No education projections yet" description="Start a Comprehensive plan, enter years-to-college and cost, and calculate to see funding needs here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((m) => {
            const o = m.envelope.output as
              | { shortfall?: number; surplus?: number; capitalNeededAtStart?: number; projectedSavingsAtStart?: number; totalProjectedCost?: number; fundedRatio?: number; yearsUntilCollege?: number }
              | undefined
            const funded = (o?.shortfall ?? 0) <= 0
            return (
              <Link key={m.planId} href={`/app/fna/plans/${m.planId}/results`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{m.householdName}</p>
                      {funded ? <Badge variant="active">Funded</Badge> : <Badge variant="destructive">Shortfall</Badge>}
                    </div>
                    <p className={`text-2xl font-semibold tabular-nums ${funded ? 'text-status-active' : 'text-destructive'}`}>
                      {funded ? `${fmtMoney(o?.surplus)} surplus` : `${fmtMoney(o?.shortfall)} short`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      projected {fmtMoney(o?.projectedSavingsAtStart)} / needed {fmtMoney(o?.capitalNeededAtStart)} · funded {fmtPercent(o?.fundedRatio, 0)}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <ConfidenceBadge confidence={m.confidence as 'high' | 'medium' | 'low'} />
                      {typeof o?.yearsUntilCollege === 'number' ? <span className="text-xs text-muted-foreground">{o.yearsUntilCollege} yrs to college</span> : null}
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
