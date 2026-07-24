import Link from 'next/link'
import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ReviewRow {
  id: string
  household_id: string
  type: string
  stage: string
  scheduled_at: string | null
  households: { primary_name: string } | { primary_name: string }[] | null
}

const STAGE_TONE: Record<string, 'active' | 'draft' | 'outline'> = {
  completed: 'active',
  outcome_logged: 'active',
  prepared: 'draft',
  scheduled: 'draft',
  requested: 'outline',
}

// Planning-scoped Reviews view (build instruction §8). A read view over the SAME
// reviews / review_types tables — recurring reviews (annual, life-event, policy,
// retirement) can trigger an FNA refresh. This does NOT replace the Pipeline →
// Reviews page. Roles: fsa.
export default async function FnaReviewsPage() {
  await requireRole('fsa', '/app/fna/reviews')

  const res = await load<ReviewRow[]>(
    (db) => db.from('reviews').select('id, household_id, type, stage, scheduled_at, households(primary_name)').order('scheduled_at', { ascending: false, nullsFirst: false }).limit(100),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Reviews' }]

  if (!res.ok) {
    return (
      <ListShell title="Reviews" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </ListShell>
    )
  }

  return (
    <ListShell
      title="Reviews"
      description="Annual, life-event, policy, and retirement reviews — a planning-scoped view over the review spine. Start or refresh an FNA from a review."
      breadcrumb={breadcrumb}
    >
      {res.data.length === 0 ? (
        <EmptyState title="No reviews yet" description="Reviews created in the pipeline appear here as planning triggers — each can kick off an FNA refresh." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {res.data.map((r) => {
                const hh = Array.isArray(r.households) ? r.households[0] : r.households
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{hh?.primary_name ?? 'Household'}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.type.replace(/_/g, ' ')} review{r.scheduled_at ? ` · ${new Date(r.scheduled_at).toLocaleDateString('en-US')}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge variant={STAGE_TONE[r.stage] ?? 'outline'}>{r.stage.replace(/_/g, ' ')}</Badge>
                      <Link href="/app/fna/plans/new" className="text-xs text-primary hover:underline">Start FNA</Link>
                    </div>
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
