import Link from 'next/link'
import { BoardShell, BoardColumn, ErrorState } from '@/components/archetypes'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { REVIEW_STAGE } from '@/lib/validation/schemas'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-06 Review Board (A4). Completing a review routes to /outcome (no review is
// "done" without an outcome record).
export default async function ReviewBoardPage() {
  const [reviews, households] = await Promise.all([
    load<{ id: string; household_id: string; type: string; stage: string; scheduled_at: string | null }[]>(
      (db) => db.from('reviews').select('id, household_id, type, stage, scheduled_at').is('deleted_at', null).order('scheduled_at', { ascending: true, nullsFirst: false }),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  if (!reviews.ok) return <ErrorState description={reviews.kind === 'not_configured' ? 'Database not configured.' : reviews.message} />
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))

  return (
    <BoardShell
      title="Review Board"
      description="Drag-free stage view. Advance from a review's workspace; completion requires an outcome."
      actions={<Button asChild variant="outline"><Link href="/app/reviews">List</Link></Button>}
    >
      {REVIEW_STAGE.map((stage) => {
        const items = reviews.data.filter((r) => r.stage === stage)
        return (
          <BoardColumn key={stage} title={stage.replace(/_/g, ' ')} count={items.length}>
            {items.map((r) => (
              <Link key={r.id} href={`/app/reviews/${r.id}`} className="block">
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="space-y-1 p-3">
                    <p className="text-sm font-medium">{hhMap.get(r.household_id) ?? 'Review'}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{r.type.replace(/_/g, ' ')}</Badge>
                      {r.scheduled_at ? <Numeric className="text-xs text-muted-foreground">{new Date(r.scheduled_at).toLocaleDateString('en-US')}</Numeric> : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {items.length === 0 ? <p className="px-1 text-xs text-muted-foreground">Empty</p> : null}
          </BoardColumn>
        )
      })}
    </BoardShell>
  )
}
