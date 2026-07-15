import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { ReviewStageControl } from '@/components/app/ReviewStageControl'
import { SecuritiesChip } from '@/components/ui/securities'

export const dynamic = 'force-dynamic'

interface Review {
  id: string
  household_id: string
  type: string
  stage: string
  scheduled_at: string | null
  agenda: unknown
  outcome: Record<string, unknown> | null
  generated_opp_ids: string[] | null
  replacement_flag: boolean
  securities_routed: boolean
}

const STAGE_STATUS: Record<string, 'draft' | 'active' | 'pending' | 'won'> = {
  requested: 'draft',
  scheduled: 'pending',
  prepared: 'active',
  completed: 'active',
  outcome_logged: 'won',
}

// OS-06 Review Workspace (A3).
export default async function ReviewDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Review | null>((db) => db.from('reviews').select('*').eq('id', params.id).is('deleted_at', null).maybeSingle(), null)
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const r = res.data
  if (!r) notFound()

  const hh = await load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', r.household_id).maybeSingle(), null)
  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const agenda = Array.isArray(r.agenda) ? (r.agenda as string[]) : []
  const oppIds = Array.isArray(r.generated_opp_ids) ? r.generated_opp_ids : []
  const outcome = r.outcome

  return (
    <DetailShell
      title={householdName ? `${r.type.replace(/_/g, ' ')} review — ${householdName}` : 'Review'}
      description={r.scheduled_at ? `Scheduled ${new Date(r.scheduled_at).toLocaleString('en-US')}` : 'Not yet scheduled'}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: householdName ?? 'Review' }]}
      status={
        <span className="flex items-center gap-2">
          <StatusBadge status={STAGE_STATUS[r.stage] ?? 'draft'} label={r.stage.replace(/_/g, ' ')} />
          {r.replacement_flag ? <Badge variant="blocked">replacement flagged</Badge> : null}
          {r.securities_routed ? <SecuritiesChip /> : null}
        </span>
      }
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline"><Link href={`/app/reviews/${r.id}/prep`}>Prep</Link></Button>
          <Button asChild variant="outline"><Link href={`/app/reviews/${r.id}/needs-map`}>Needs Map</Link></Button>
          <Button asChild><Link href={`/app/reviews/${r.id}/outcome`}>Outcome</Link></Button>
        </div>
      }
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href={`/app/households/${r.household_id}`} className="text-primary hover:underline">Household</Link></li>
            <li><Link href={`/app/reviews/${r.id}/prep`} className="text-primary hover:underline">Prep snapshot</Link></li>
            <li><Link href={`/app/reviews/${r.id}/needs-map`} className="text-primary hover:underline">Needs Map</Link></li>
            <li><Link href={`/app/reviews/${r.id}/outcome`} className="text-primary hover:underline">Outcome</Link></li>
            {oppIds.map((id) => (<li key={id}><Link href={`/app/opportunities/${id}`} className="text-primary hover:underline">Originated opportunity</Link></li>))}
          </ul>
        </div>
      }
    >
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Stage</CardTitle>
          <ReviewStageControl id={r.id} stage={r.stage} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A review discovers needs and originates opportunities. It can never be saved as a recommendation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Agenda</CardTitle></CardHeader>
        <CardContent>
          {agenda.length === 0 ? <p className="text-sm text-muted-foreground">No agenda template.</p> : (
            <ul className="list-disc space-y-1 pl-5 text-sm">{agenda.map((a, i) => (<li key={i}>{a}</li>))}</ul>
          )}
        </CardContent>
      </Card>

      {outcome ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Outcome — needs discovered</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {['goals', 'coverage_held', 'gaps_observed', 'life_events', 'meeting_notes'].map((k) =>
              outcome[k] ? (
                <div key={k}>
                  <p className="text-xs font-medium capitalize text-muted-foreground">{k.replace(/_/g, ' ')}</p>
                  <p className="whitespace-pre-wrap">{String(outcome[k])}</p>
                </div>
              ) : null,
            )}
            <p className="pt-2 text-xs text-muted-foreground">{oppIds.length} opportunit{oppIds.length === 1 ? 'y' : 'ies'} originated.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Outcome</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No outcome recorded yet. <Link href={`/app/reviews/${r.id}/outcome`} className="text-primary hover:underline">Record the outcome</Link> to originate opportunities.</p>
          </CardContent>
        </Card>
      )}
    </DetailShell>
  )
}
