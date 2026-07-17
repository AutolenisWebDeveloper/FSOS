import Link from 'next/link'
import { FormShell, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { ReviewForm } from '@/components/app/ReviewForm'

export const dynamic = 'force-dynamic'

// OS-06 Schedule / Create Review (A5).
export default async function NewReviewPage(props: { searchParams: Promise<{ household?: string; type?: string }> }) {
  const searchParams = await props.searchParams;
  const households = await load<{ id: string; primary_name: string }[]>(
    (db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name'),
    [],
  )
  const noHouseholds = households.ok && households.data.length === 0
  const crumb = [{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: 'Schedule' }]

  return (
    <FormShell title="Schedule a Review" description="Create a review, appointment, and prep task." breadcrumb={crumb}>
      {noHouseholds ? (
        <EmptyState title="No households yet" description="A review belongs to a household. Add one first." action={<Button asChild><Link href="/app/households/new">Add a household</Link></Button>} />
      ) : (
        <ReviewForm households={households.ok ? households.data : []} defaultHousehold={searchParams.household} defaultType={searchParams.type} />
      )}
    </FormShell>
  )
}
