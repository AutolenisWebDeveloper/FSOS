import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-06 Review Prep (A3). Read-only assembly of a household snapshot — policies,
// prior reviews, coverage gaps (from v_cross_sell_gaps), conversion windows.
// NO recommendation is produced; this is fact assembly only.
export default async function ReviewPrepPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; household_id: string; type: string } | null>(
    (db) => db.from('reviews').select('id, household_id, type').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const review = res.data
  if (!review) notFound()

  const [hh, policies, priorReviews, gaps] = await Promise.all([
    load<{ primary_name: string } | null>((db) => db.from('households').select('primary_name').eq('id', review.household_id).maybeSingle(), null),
    load<{ id: string; policy_number: string | null; status: string; is_with_us: boolean; is_security: boolean; conversion_deadline: string | null; premium: number | null }[]>(
      (db) => db.from('household_policies').select('id, policy_number, status, is_with_us, is_security, conversion_deadline, premium').eq('household_id', review.household_id).is('deleted_at', null),
      [],
    ),
    load<{ id: string; type: string; stage: string; scheduled_at: string | null }[]>(
      (db) => db.from('reviews').select('id, type, stage, scheduled_at').eq('household_id', review.household_id).neq('id', review.id).is('deleted_at', null).order('scheduled_at', { ascending: false }).limit(5),
      [],
    ),
    load<{ next_best_line: string | null; gap_count: number; has_life: boolean } | null>(
      (db) => db.from('v_cross_sell_gaps').select('next_best_line, gap_count, has_life').eq('household_id', review.household_id).maybeSingle(),
      null,
    ),
  ])

  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const pols = policies.ok ? policies.data : []
  const conversionPolicies = pols.filter((p) => p.conversion_deadline)

  return (
    <DetailShell
      title={`Prep — ${householdName ?? 'household'}`}
      description="Read-only snapshot. Fact assembly for the meeting — no recommendation."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: householdName ?? 'Review', href: `/app/reviews/${review.id}` }, { label: 'Prep' }]}
      actions={<Button asChild variant="outline"><Link href={`/app/reviews/${review.id}`}>Back to review</Link></Button>}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Policies held</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {pols.length === 0 ? <p className="text-muted-foreground">No existing coverage — needs-discovery / new-business review.</p> : pols.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b py-1 last:border-0">
              <span>{p.policy_number ?? 'Policy'} · <span className="capitalize text-muted-foreground">{p.status}</span></span>
              <span className="flex items-center gap-2">
                {p.is_with_us ? <Badge variant="active">with us</Badge> : <Badge variant="outline">competitor</Badge>}
                {p.is_security ? <Badge variant="blocked">securities</Badge> : null}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Coverage gaps</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {gaps.ok && gaps.data ? (
              <>
                <p>Next coverage gap: <span className="font-medium capitalize">{gaps.data.next_best_line ?? 'none'}</span></p>
                <p className="text-muted-foreground">{gaps.data.gap_count} gap(s) vs the recommended basket. {gaps.data.has_life ? 'Has life.' : 'No life on file.'}</p>
                <p className="text-xs text-muted-foreground">A gap is a coverage opportunity, not a product recommendation.</p>
              </>
            ) : (
              <p className="text-muted-foreground">No gaps computed (household already multi-line or opted out).</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Conversion windows</CardTitle>
            <AssumptionBadge />
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {conversionPolicies.length === 0 ? <p className="text-muted-foreground">No policies with a configured conversion window.</p> : conversionPolicies.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>{p.policy_number ?? 'Policy'}</span>
                <span className="text-muted-foreground">deadline {p.conversion_deadline}</span>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">Window is a config default — verify against the FNWL contract.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Prior reviews</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {priorReviews.ok && priorReviews.data.length > 0 ? priorReviews.data.map((p) => (
            <Link key={p.id} href={`/app/reviews/${p.id}`} className="flex justify-between border-b py-1 last:border-0 hover:text-primary">
              <span className="capitalize">{p.type.replace(/_/g, ' ')} · {p.stage.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">{p.scheduled_at ? new Date(p.scheduled_at).toLocaleDateString('en-US') : '—'}</span>
            </Link>
          )) : <p className="text-muted-foreground">No prior reviews.</p>}
        </CardContent>
      </Card>
    </DetailShell>
  )
}
