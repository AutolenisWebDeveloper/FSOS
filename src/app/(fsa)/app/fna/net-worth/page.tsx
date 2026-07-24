import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { loadModuleResults } from '@/lib/fna/module-results'
import { ConfidenceBadge, fmtMoney } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Net-worth module (build instruction §8). Reads the latest calculated net-worth
// result per plan — total assets less total liabilities. Roles: fsa.
export default async function FnaNetWorthPage() {
  await requireRole('fsa', '/app/fna/net-worth')
  const res = await loadModuleResults('net_worth')

  const header = (
    <PageHeader
      title="Net worth"
      description="Balance sheet — total assets less total liabilities, the latest calculated figure per plan."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Net worth' }]}
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
        <EmptyState title="No calculated net worth yet" description="Start a plan, enter assets and liabilities, and calculate to see the balance sheet here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((m) => {
            const o = m.envelope.output as { netWorth?: number; totalAssets?: number; totalLiabilities?: number } | undefined
            return (
              <Link key={m.planId} href={`/app/fna/plans/${m.planId}/results`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{m.householdName}</p>
                      <ConfidenceBadge confidence={m.confidence as 'high' | 'medium' | 'low'} />
                    </div>
                    <p className={`text-2xl font-semibold tabular-nums ${(o?.netWorth ?? 0) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(o?.netWorth)}</p>
                    <p className="text-xs text-muted-foreground">
                      assets {fmtMoney(o?.totalAssets)} · liabilities {fmtMoney(o?.totalLiabilities)} · v{m.versionNo}
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
