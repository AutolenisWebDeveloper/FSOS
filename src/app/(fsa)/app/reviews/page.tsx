import Link from 'next/link'
import { Plus, LayoutGrid, CalendarDays, Clock } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { ReviewList, type ReviewRow } from '@/components/app/ReviewList'

export const dynamic = 'force-dynamic'

// OS-06 Financial Review Directory (A2). The connective spine (WF-2).
export default async function ReviewsPage(props: { searchParams: Promise<{ household?: string }> }) {
  const searchParams = await props.searchParams;
  const [reviews, households] = await Promise.all([
    load<{ id: string; household_id: string; type: string; stage: string; scheduled_at: string | null; generated_opp_ids: string[] | null }[]>(
      (db) => {
        let q = db.from('reviews').select('id, household_id, type, stage, scheduled_at, generated_opp_ids').is('deleted_at', null).order('scheduled_at', { ascending: true, nullsFirst: false })
        if (searchParams.household) q = q.eq('household_id', searchParams.household)
        return q
      },
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])

  const actions = (
    <div className="flex gap-2">
      <Button asChild variant="outline"><Link href="/app/reviews/due"><Clock className="h-4 w-4" /> Due</Link></Button>
      <Button asChild variant="outline"><Link href="/app/reviews/calendar"><CalendarDays className="h-4 w-4" /> Calendar</Link></Button>
      <Button asChild variant="outline"><Link href="/app/reviews/board"><LayoutGrid className="h-4 w-4" /> Board</Link></Button>
      <Button asChild><Link href="/app/reviews/new"><Plus className="h-4 w-4" /> Schedule</Link></Button>
    </div>
  )

  let body: React.ReactNode
  if (!reviews.ok) {
    body = reviews.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load reviews." /> : <ErrorState description={reviews.message} />
  } else {
    const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))
    const rows: ReviewRow[] = reviews.data.map((r) => ({
      id: r.id,
      household_name: hhMap.get(r.household_id) ?? null,
      type: r.type,
      stage: r.stage,
      scheduled_at: r.scheduled_at,
      generated_count: Array.isArray(r.generated_opp_ids) ? r.generated_opp_ids.length : 0,
    }))
    body = <ReviewList rows={rows} />
  }

  return (
    <ListShell title="Financial Reviews" description="Where needs are discovered and opportunities originate." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
