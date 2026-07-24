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

const PAGE_SIZE = 50

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

export default async function FnaPlansPage(props: { searchParams: Promise<{ page?: string }> }) {
  await requireRole('fsa', '/app/fna/plans')

  const sp = await props.searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const from = (page - 1) * PAGE_SIZE
  // Fetch one extra row to know whether a next page exists without a count query.
  const res = await load<PlanRow[]>(
    (db) =>
      db
        .from('fna_plans')
        .select('id, plan_type, status, title, updated_at, households(primary_name)')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .range(from, from + PAGE_SIZE),
    [],
  )
  const hasNext = res.ok && res.data.length > PAGE_SIZE
  const rows = res.ok ? res.data.slice(0, PAGE_SIZE) : []

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
      {rows.length === 0 ? (
        page > 1 ? (
          <EmptyState
            title="No more plans"
            description="You're past the last page."
            action={
              <Button asChild variant="outline">
                <Link href={`/app/fna/plans?page=${page - 1}`}>Previous page</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No plans yet"
            description="Start an Express Financial Checkup for a household — minimum inputs, immediate results."
            action={actions}
          />
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {rows.map((p) => {
                const hh = unwrapOne(p.households)
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

      {(page > 1 || hasNext) && (
        <nav className="flex items-center justify-between pt-4" aria-label="Plans pagination">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/fna/plans?page=${page - 1}`} rel="prev">Previous</Link>
            </Button>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted-foreground">Page {page}</span>
          {hasNext ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/fna/plans?page=${page + 1}`} rel="next">Next</Link>
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </ListShell>
  )
}
