import Link from 'next/link'
import { FormShell, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { OpportunityForm } from '@/components/app/OpportunityForm'

export const dynamic = 'force-dynamic'

// OS-09 Create Opportunity (A5). Empty product catalog → guide to /super/products.
export default async function NewOpportunityPage({ searchParams }: { searchParams: { household?: string } }) {
  const [households, products, agencies] = await Promise.all([
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name'), []),
    load<{ id: string; family: string; subtype: string | null; is_security: boolean }[]>((db) => db.from('products').select('id, family, subtype, is_security').eq('active', true).order('family'), []),
    load<{ id: string; agency_name: string }[]>((db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).order('agency_name'), []),
  ])

  const noHouseholds = households.ok && households.data.length === 0
  const crumb = [{ label: 'FSA', href: '/app' }, { label: 'Opportunities', href: '/app/opportunities' }, { label: 'New' }]

  return (
    <FormShell title="New Opportunity" description="Originate a pipeline opportunity." breadcrumb={crumb} onSubmitNote="Securities products are scope-gated; FSOS stores no securities substance.">
      {noHouseholds ? (
        <EmptyState title="No households yet" description="An opportunity belongs to a household. Add one, or convert a referral." action={<Button asChild><Link href="/app/households/new">Add a household</Link></Button>} />
      ) : (
        <OpportunityForm
          households={households.ok ? households.data : []}
          products={products.ok ? products.data : []}
          agencies={agencies.ok ? agencies.data : []}
          defaultHousehold={searchParams.household}
        />
      )}
    </FormShell>
  )
}
