import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load, unwrapOne } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { planTypeDef } from '@/lib/fna/plan-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlanRow {
  id: string
  plan_type: string
  title: string | null
  current_version_id: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
  fna_scenarios: { count: number }[] | null
}

// Scenario center (build instruction §8). Plans that have a calculated version can
// carry what-if scenarios; open one to build and compare. Roles: fsa.
export default async function FnaScenarioCenterPage() {
  await requireRole('fsa', '/app/fna/scenarios')

  const res = await load<PlanRow[]>(
    (db) =>
      db
        .from('fna_plans')
        .select('id, plan_type, title, current_version_id, households(primary_name), fna_scenarios(count)')
        .is('deleted_at', null)
        .not('current_version_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(100),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Scenarios' }]

  if (!res.ok) {
    return (
      <ListShell title="Scenario center" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Scenario center"
      description="Build and compare what-if scenarios on any calculated plan — retirement age, savings, inflation, market stress, longevity, and more."
      breadcrumb={breadcrumb}
      actions={
        <Button asChild variant="outline">
          <Link href="/app/fna/plans">All plans</Link>
        </Button>
      }
    >
      {res.data.length === 0 ? (
        <EmptyState
          title="No calculated plans yet"
          description="Scenarios branch from a plan's frozen version. Start a plan and calculate it, then build scenarios."
          action={
            <Button asChild>
              <Link href="/app/fna/plans/new">Start a plan</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((p) => {
            const hh = unwrapOne(p.households)
            const count = p.fna_scenarios?.[0]?.count ?? 0
            return (
              <Link key={p.id} href={`/app/fna/plans/${p.id}/scenarios`}>
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardContent className="flex items-center justify-between gap-2 pt-6">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.title || hh?.primary_name || 'Plan'}</p>
                      <p className="text-xs text-muted-foreground">{planTypeDef(p.plan_type)?.label ?? p.plan_type}</p>
                    </div>
                    <Badge variant={count > 0 ? 'active' : 'outline'}>{count} scenario{count === 1 ? '' : 's'}</Badge>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </ListShell>
  )
}
