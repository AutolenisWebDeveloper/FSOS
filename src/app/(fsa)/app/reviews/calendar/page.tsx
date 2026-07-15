import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-06 Review Calendar (A1-cal). Upcoming scheduled reviews grouped by date.
export default async function ReviewCalendarPage() {
  const [reviews, households] = await Promise.all([
    load<{ id: string; household_id: string; type: string; scheduled_at: string | null; stage: string }[]>(
      (db) => db.from('reviews').select('id, household_id, type, scheduled_at, stage').is('deleted_at', null).not('scheduled_at', 'is', null).gte('scheduled_at', new Date(Date.now() - 86400000).toISOString()).order('scheduled_at', { ascending: true }).limit(100),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  if (!reviews.ok) return <ErrorState description={reviews.kind === 'not_configured' ? 'Database not configured.' : reviews.message} />
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))

  const byDate = new Map<string, typeof reviews.data>()
  for (const r of reviews.data) {
    const d = r.scheduled_at ? new Date(r.scheduled_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unscheduled'
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(r)
  }

  return (
    <ListShell
      title="Review Calendar"
      description="Upcoming scheduled reviews. Appointments fall back to manual entry when Google Calendar is not connected."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: 'Calendar' }]}
      actions={<Button asChild><Link href="/app/reviews/new">Schedule</Link></Button>}
    >
      {reviews.data.length === 0 ? (
        <EmptyState title="No upcoming reviews" description="Schedule a review to see it here." action={<Button asChild><Link href="/app/reviews/new">Schedule a review</Link></Button>} />
      ) : (
        <div className="space-y-4">
          {Array.from(byDate.entries()).map(([date, items]) => (
            <div key={date} className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{date}</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((r) => (
                  <Link key={r.id} href={`/app/reviews/${r.id}`}>
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="flex items-center justify-between p-3 text-sm">
                        <div>
                          <p className="font-medium">{hhMap.get(r.household_id) ?? 'Review'}</p>
                          <p className="text-xs text-muted-foreground">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}</p>
                        </div>
                        <Badge variant="outline" className="capitalize">{r.type.replace(/_/g, ' ')}</Badge>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ListShell>
  )
}
