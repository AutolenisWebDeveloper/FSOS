import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { loadModuleResults, type ModuleResult } from '@/lib/fna/module-results'
import { fmtMoney } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Protection module (build instruction §8). Coverage inventory + life / disability
// gaps from the latest calculated version per plan. LTC discovery is captured in
// intake (Comprehensive) and surfaced as it lands. Analysis only (§1). Roles: fsa.
export default async function FnaProtectionPage() {
  await requireRole('fsa', '/app/fna/protection')

  const [life, disability, coverage] = await Promise.all([
    loadModuleResults('life_insurance_need'),
    loadModuleResults('disability_exposure'),
    loadModuleResults('coverage_gap'),
  ])

  const header = (
    <PageHeader
      title="Protection"
      description="Life and disability coverage gaps from the latest calculated plan — analysis of needs, never a product recommendation."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Protection' }]}
      actions={
        <Button asChild>
          <Link href="/app/fna/plans/new">Start a plan</Link>
        </Button>
      }
    />
  )

  if (!life.ok) {
    return (
      <div className="space-y-6">
        {header}
        {life.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={life.message} />}
      </div>
    )
  }

  const byPlan = new Map<string, { name: string; life?: ModuleResult; disability?: ModuleResult; coverage?: ModuleResult }>()
  const add = (arr: ModuleResult[] | undefined, key: 'life' | 'disability' | 'coverage') => {
    for (const m of arr ?? []) {
      const e = byPlan.get(m.planId) ?? { name: m.householdName }
      e[key] = m
      byPlan.set(m.planId, e)
    }
  }
  add(life.data, 'life')
  add(disability.ok ? disability.data : [], 'disability')
  add(coverage.ok ? coverage.data : [], 'coverage')

  const rows = [...byPlan.entries()]

  return (
    <div className="space-y-6">
      {header}
      {rows.length === 0 ? (
        <EmptyState title="No protection analysis yet" description="Start a plan, enter income and in-force coverage, and calculate to see life and disability gaps here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([planId, e]) => {
            const lifeOut = e.life?.envelope.output as { incomeReplacement?: { additionalNeed?: number }; capitalNeeds?: { additionalNeed?: number } } | undefined
            const disOut = e.disability?.envelope.output as { monthlyGap?: number } | undefined
            return (
              <Link key={planId} href={`/app/fna/plans/${planId}/results`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 pt-6">
                    <p className="truncate font-medium">{e.name}</p>
                    <dl className="space-y-1 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Life gap (income repl.)</dt>
                        <dd className="font-mono tabular-nums">{fmtMoney(lifeOut?.incomeReplacement?.additionalNeed)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Life gap (capital needs)</dt>
                        <dd className="font-mono tabular-nums">{fmtMoney(lifeOut?.capitalNeeds?.additionalNeed)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Disability gap / mo</dt>
                        <dd className="font-mono tabular-nums">{fmtMoney(disOut?.monthlyGap)}</dd>
                      </div>
                    </dl>
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
