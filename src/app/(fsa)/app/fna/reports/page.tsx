import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState, Section } from '@/components/archetypes'
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
  status: string
  title: string | null
  updated_at: string
  households: { primary_name: string } | { primary_name: string }[] | null
}

// Reports (build instruction §8). Client reports + internal packages are generated
// from an APPROVED version. This index surfaces approved plans (ready to present)
// and calculated-but-unapproved plans (ready to review). Roles: fsa.
export default async function FnaReportsPage() {
  await requireRole('fsa', '/app/fna/reports')

  const res = await load<PlanRow[]>(
    (db) =>
      db
        .from('fna_plans')
        .select('id, plan_type, status, title, updated_at, households(primary_name)')
        .is('deleted_at', null)
        .in('status', ['APPROVED', 'CALCULATED', 'UNDER_REVIEW'])
        .order('updated_at', { ascending: false })
        .limit(100),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Reports' }]

  if (!res.ok) {
    return (
      <ListShell title="Reports" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  const approved = res.data.filter((p) => p.status === 'APPROVED')
  const pending = res.data.filter((p) => p.status !== 'APPROVED')

  const list = (rows: PlanRow[], empty: string) =>
    rows.length === 0 ? (
      <EmptyState title="Nothing here yet" description={empty} />
    ) : (
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {rows.map((p) => {
              const hh = unwrapOne(p.households)
              return (
                <li key={p.id}>
                  <Link href={`/app/fna/plans/${p.id}/report`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.title || hh?.primary_name || 'Plan'}</p>
                      <p className="text-xs text-muted-foreground">{planTypeDef(p.plan_type)?.label ?? p.plan_type}</p>
                    </div>
                    <Badge variant={p.status === 'APPROVED' ? 'active' : 'draft'}>{p.status.replace(/_/g, ' ')}</Badge>
                  </Link>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    )

  return (
    <ListShell
      title="Reports"
      description="Generate a client report or internal package from an approved version. Every figure is reproducible from the version it was built on."
      breadcrumb={breadcrumb}
      actions={
        <Button asChild variant="outline">
          <Link href="/app/fna/plans">All plans</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        <Section title="Approved — ready to present" description="Client-presentable. Download the PDF or the internal Excel package.">
          {list(approved, 'Approve a calculated plan to make it client-presentable.')}
        </Section>
        <Section title="Ready to review" description="Calculated plans awaiting approval before they can be presented.">
          {list(pending, 'Calculate a plan to prepare its report.')}
        </Section>
      </div>
    </ListShell>
  )
}
