import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, CircleDashed, Users } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { DetailShell, ErrorState, AssumptionBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonoLabel } from '@/components/ui/typography'
import { SecuritiesBanner } from '@/components/ui/securities'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Needs Map (docs/legacy-port.md §2.7) — a tab in the Review workspace (A3). A
// visual coverage/needs map for the household: what's held, what's a gap, life-stage
// context. Displays GAPS ONLY — never a product recommendation. Framed as "coverage
// gap / discussion topic." The recommended basket is assumption-flagged config.
export default async function NeedsMapPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireRole('fsa', `/app/reviews/${params.id}/needs-map`)

  const res = await load<{ id: string; household_id: string } | null>(
    (db) => db.from('reviews').select('id, household_id').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const review = res.data
  if (!review) notFound()

  const [hh, members, policies, gaps, basket] = await Promise.all([
    load<{ primary_name: string } | null>(
      (db) => db.from('households').select('primary_name').eq('id', review.household_id).maybeSingle(),
      null,
    ),
    load<{ id: string; full_name: string; relationship: string | null }[]>(
      (db) => db.from('household_members').select('id, full_name, relationship').eq('household_id', review.household_id),
      [],
    ),
    load<{ id: string; is_security: boolean }[]>(
      (db) =>
        db
          .from('household_policies')
          .select('id, is_security')
          .eq('household_id', review.household_id)
          .is('deleted_at', null),
      [],
    ),
    load<{ families_held: string[] | null; has_life: boolean; next_best_line: string | null; gap_count: number } | null>(
      (db) =>
        db
          .from('v_cross_sell_gaps')
          .select('families_held, has_life, next_best_line, gap_count')
          .eq('household_id', review.household_id)
          .maybeSingle(),
      null,
    ),
    load<{ line: string; priority: number; is_assumption: boolean }[]>(
      (db) => db.from('cross_sell_basket').select('line, priority, is_assumption').order('priority', { ascending: true }),
      [],
    ),
  ])

  const householdName = hh.ok ? hh.data?.primary_name ?? null : null
  const held = new Set((gaps.ok && gaps.data?.families_held) || [])
  const gapCount = gaps.ok ? gaps.data?.gap_count ?? 0 : 0
  const nextLine = gaps.ok ? gaps.data?.next_best_line ?? null : null
  const hasSecurities = policies.ok && policies.data.some((p) => p.is_security)
  const lines = basket.ok ? basket.data : []

  return (
    <DetailShell
      title={`Needs Map — ${householdName ?? 'household'}`}
      description="What's held vs. where the gaps are. Gaps are discussion topics — never a product recommendation."
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Reviews', href: '/app/reviews' },
        { label: householdName ?? 'Review', href: `/app/reviews/${review.id}` },
        { label: 'Needs Map' },
      ]}
      actions={
        <Button asChild variant="outline">
          <Link href={`/app/reviews/${review.id}`}>Back to review</Link>
        </Button>
      }
    >
      {hasSecurities ? <SecuritiesBanner /> : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Coverage map</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {gapCount > 0 ? `${gapCount} coverage gap(s) vs. the recommended basket.` : 'No open gaps vs. the basket.'}
            </p>
          </div>
          <AssumptionBadge label="basket: config default" />
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No coverage basket configured.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {lines.map((l) => {
                const isHeld = held.has(l.line)
                const isNext = nextLine === l.line
                return (
                  <li
                    key={l.line}
                    className={
                      isHeld
                        ? 'rounded-lg border border-status-won/40 bg-status-won/10 p-4'
                        : 'rounded-lg border border-status-assumption/40 bg-status-assumption/10 p-4'
                    }
                  >
                    <div className="flex items-center justify-between">
                      <MonoLabel className={isHeld ? 'text-status-won' : 'text-status-assumption'}>{l.line}</MonoLabel>
                      {isHeld ? (
                        <Check className="h-4 w-4 text-status-won" aria-hidden />
                      ) : (
                        <CircleDashed className="h-4 w-4 text-status-assumption" aria-hidden />
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium">{isHeld ? 'Held' : 'Coverage gap'}</p>
                    {isNext ? <p className="mt-0.5 text-xs text-muted-foreground">Highest-priority discussion topic</p> : null}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            A gap is a coverage discussion topic for the review, not a product recommendation. Basket order is a config
            default — verify against book strategy.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base">Household &amp; life-stage context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {members.ok && members.data.length > 0 ? (
            members.data.map((m) => (
              <div key={m.id} className="flex items-center justify-between border-b py-1 last:border-0">
                <span className="font-medium">{m.full_name}</span>
                <Badge variant="outline">{m.relationship ?? 'member'}</Badge>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">No household members on file yet.</p>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            {gaps.ok && gaps.data?.has_life ? 'Life coverage on file.' : 'No life coverage on file — a discussion topic.'}
          </p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
