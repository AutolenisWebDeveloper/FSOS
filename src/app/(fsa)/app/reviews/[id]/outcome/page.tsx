import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FormShell, ErrorState, CompletionScreen } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { ReviewOutcomeForm } from '@/components/app/ReviewOutcomeForm'

export const dynamic = 'force-dynamic'

// OS-06 Review Outcome (A5). Records needs + originates opportunities. Already-logged
// outcomes show a completion screen with next actions (never a dead end).
export default async function ReviewOutcomePage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; household_id: string; stage: string; generated_opp_ids: string[] | null } | null>(
    (db) => db.from('reviews').select('id, household_id, stage, generated_opp_ids').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const review = res.data
  if (!review) notFound()

  if (review.stage === 'outcome_logged') {
    const oppIds = Array.isArray(review.generated_opp_ids) ? review.generated_opp_ids : []
    return (
      <CompletionScreen
        title="Outcome already logged"
        description={`${oppIds.length} opportunit${oppIds.length === 1 ? 'y' : 'ies'} originated from this review.`}
        nextActions={[
          { label: 'Back to review', href: `/app/reviews/${review.id}` },
          { label: 'View pipeline', href: '/app/opportunities/board' },
          ...(oppIds[0] ? [{ label: 'First opportunity', href: `/app/opportunities/${oppIds[0]}` }] : []),
        ]}
      />
    )
  }

  const products = await load<{ id: string; family: string; subtype: string | null; is_security: boolean }[]>(
    (db) => db.from('products').select('id, family, subtype, is_security').eq('active', true).order('family'),
    [],
  )

  return (
    <FormShell
      title="Review Outcome"
      description="Record needs discovered and originate opportunities. This is not a recommendation."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: 'Review', href: `/app/reviews/${review.id}` }, { label: 'Outcome' }]}
    >
      <ReviewOutcomeForm reviewId={review.id} products={products.ok ? products.data : []} />
      <p className="pt-2 text-xs text-muted-foreground">
        Related: <Link href={`/app/households/${review.household_id}`} className="text-primary hover:underline">household</Link>
      </p>
    </FormShell>
  )
}
