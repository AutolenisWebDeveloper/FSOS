import { FormShell } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { AgencyForm } from '@/components/app/AgencyForm'

export const dynamic = 'force-dynamic'

// OS-02 Create Agency Partnership (A5).
export default async function NewAgencyPage() {
  const districts = await load<{ id: string; name: string }[]>(
    (db) => db.from('districts').select('id, name').order('name'),
    [],
  )
  return (
    <FormShell
      title="New Agency Partnership"
      description="Add a Farmers agency-owner partnership to your book."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Agencies', href: '/app/agencies' }, { label: 'New' }]}
      onSubmitNote="Validated with Zod on submit and again on the server before any write."
    >
      <AgencyForm districts={districts.ok ? districts.data : []} />
    </FormShell>
  )
}
