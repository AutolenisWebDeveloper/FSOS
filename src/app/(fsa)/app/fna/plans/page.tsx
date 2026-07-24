import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
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

const STATUS_TONE: Record<string, 'active' | 'draft' | 'outline'> = {
  APPROVED: 'active',
  CALCULATED: 'active',
  UNDER_REVIEW: 'draft',
  IN_PROGRESS: 'draft',
  DRAFT: 'outline',
}

export default async function FnaPlansPage() {
  await requireRole('fsa', '/app/fna/plans')

  const res = await load<PlanRow[]>(
    (db) =>
      db
        .from('fna_plans')
        .select('id, plan_type, status, title, updated_at, households(primary_name)')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
    [],
  )

  const actions = (
    <Button asChild>
      <Link href="/app/fna/plans/new">Start a plan</Link>
    </Button>
  )

  if (!res.ok) {
    return (
      <ListShell title="Plans" breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Plans' }]} actions={actions}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Plans"
      description="Every structured FNA — Express, Comprehensive, Financial Plan, and Annual Review — across households."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Plans' }]}
      actions={actions}
    >
      {res.data.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="Start an Express Financial Checkup for a household — minimum inputs, immediate results."
          action={actions}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {res.data.map((p) => {
                const hh = Array.isArray(p.households) ? p.households[0] : p.households
                return (
                  <li key={p.id}>
                    <Link href={`/app/fna/plans/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.title || hh?.primary_name || 'Household'}</p>
                        <p className="text-xs text-muted-foreground">
                          {planTypeDef(p.plan_type)?.label ?? p.plan_type}
                          {p.title && hh?.primary_name ? ` · ${hh.primary_name}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge variant={STATUS_TONE[p.status] ?? 'outline'}>{p.status.replace(/_/g, ' ')}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(p.updated_at).toLocaleDateString('en-US')}</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </ListShell>
  )
}
