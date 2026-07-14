import { FormShell } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { HouseholdForm } from '@/components/app/HouseholdForm'

export const dynamic = 'force-dynamic'

// OS-04 Create Household (A5).
export default async function NewHouseholdPage() {
  const agencies = await load<{ id: string; agency_name: string }[]>(
    (db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).order('agency_name'),
    [],
  )
  return (
    <FormShell
      title="New Household"
      description="Add a client household to your book."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Households', href: '/app/households' }, { label: 'New' }]}
      onSubmitNote="Validated with Zod on submit and again on the server."
    >
      <HouseholdForm agencies={agencies.ok ? agencies.data : []} />
    </FormShell>
  )
}
