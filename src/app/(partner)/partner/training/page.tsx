import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor } from '@/lib/portal/scope'
import { MarkCompleteButton } from '@/components/portal/TrainingControls'

export const dynamic = 'force-dynamic'

type TrainingRow = {
  id: string
  title: string
  description: string | null
  category: string | null
  url: string | null
  duration_min: number | null
  required: boolean
}

// P-2 Training (A2). Educational partnership material for agency owners.
export default async function PartnerTrainingPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []

  let rows: TrainingRow[] = []
  let completed = new Set<string>()
  let err: string | null = null

  try {
    const { data } = await getDb()
      .from('partner_training')
      .select('id, title, description, category, url, duration_min, required')
      .eq('published', true)
      .order('created_at')
    rows = (data ?? []) as TrainingRow[]

    if (agencyIds.length) {
      const { data: done } = await getDb()
        .from('partner_training_completions')
        .select('training_id')
        .in('agency_id', agencyIds)
      completed = new Set((done ?? []).map((r: { training_id: string }) => r.training_id))
    }
  } catch (e) {
    err = e instanceof Error ? e.message : 'Failed to load training.'
  }

  return (
    <ListShell
      title="Training"
      description="Educational partnership material to help you get the most from our partnership."
      breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Training' }]}
    >
      {err ? (
        <ErrorState description={err} />
      ) : rows.length === 0 ? (
        <EmptyState title="No training available" description="No training modules published yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((t) => {
            const isDone = completed.has(t.id)
            return (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {t.title}
                        </a>
                      ) : (
                        t.title
                      )}
                    </CardTitle>
                    {isDone ? <Badge variant="won">Completed</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {t.category ? <Badge variant="secondary">{t.category}</Badge> : null}
                    {typeof t.duration_min === 'number' ? (
                      <span className="text-xs text-muted-foreground">{t.duration_min} min</span>
                    ) : null}
                    {t.required ? <Badge variant="pending">Required</Badge> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.description ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.description}</p>
                  ) : null}
                  {isDone ? null : <MarkCompleteButton trainingId={t.id} />}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </ListShell>
  )
}
