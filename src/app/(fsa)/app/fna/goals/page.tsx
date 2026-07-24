import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { fmtMoney, fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface GoalRow {
  id: string
  goal_type: string
  label: string
  priority: number
  target_amount: number | null
  target_date: string | null
  current_funding: number
  funding_status: string | null
  progress: number | null
  households: { primary_name: string } | { primary_name: string }[] | null
}

const STATUS_TONE: Record<string, 'active' | 'draft' | 'destructive' | 'outline'> = {
  on_track: 'active',
  funded: 'active',
  at_risk: 'draft',
  off_track: 'destructive',
  unfunded: 'outline',
}

// Goals module (build instruction §8, first-class goals from ADR-016). A read view
// over fna_goals — priority, target, funding status, progress. Goal authoring lands
// with the advisor workspace; this surfaces the structured store. Roles: fsa.
export default async function FnaGoalsPage() {
  await requireRole('fsa', '/app/fna/goals')

  const res = await load<GoalRow[]>(
    (db) =>
      db
        .from('fna_goals')
        .select('id, goal_type, label, priority, target_amount, target_date, current_funding, funding_status, progress, households(primary_name)')
        .is('deleted_at', null)
        .order('priority', { ascending: true }),
    [],
  )

  const header = { breadcrumb: [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Goals' }] }

  if (!res.ok) {
    return (
      <ListShell title="Goals" breadcrumb={header.breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Goals"
      description="First-class financial goals — retirement, education, emergency fund, and more — with priority, target, and funding status."
      breadcrumb={header.breadcrumb}
      actions={
        <Button asChild variant="outline">
          <Link href="/app/fna/plans">View plans</Link>
        </Button>
      }
    >
      {res.data.length === 0 ? (
        <EmptyState
          title="No goals yet"
          description="Goals become first-class here as plans capture retirement, education, and protection targets. Start a plan to begin."
          action={
            <Button asChild>
              <Link href="/app/fna/plans/new">Start a plan</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {res.data.map((g) => {
            const hh = Array.isArray(g.households) ? g.households[0] : g.households
            return (
              <Card key={g.id}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{g.label}</p>
                    {g.funding_status ? <Badge variant={STATUS_TONE[g.funding_status] ?? 'outline'}>{g.funding_status.replace(/_/g, ' ')}</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{hh?.primary_name ?? ''} · {g.goal_type.replace(/_/g, ' ')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {fmtMoney(g.current_funding)} <span className="text-sm font-normal text-muted-foreground">of {fmtMoney(g.target_amount)}</span>
                  </p>
                  {g.progress != null ? <p className="text-xs text-muted-foreground">{fmtPercent(g.progress, 0)} funded</p> : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </ListShell>
  )
}
