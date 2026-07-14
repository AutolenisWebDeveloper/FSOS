import Link from 'next/link'
import { FormShell, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { PolicyForm } from '@/components/app/PolicyForm'

export const dynamic = 'force-dynamic'

// OS-05 Record Policy (A5). `household` query param prefills the household.
export default async function NewPolicyPage({ searchParams }: { searchParams: { household?: string } }) {
  const [households, carriers, products] = await Promise.all([
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name'), []),
    load<{ id: string; name: string }[]>((db) => db.from('carriers').select('id, name').order('name'), []),
    load<{ id: string; family: string; subtype: string | null; is_security: boolean }[]>((db) => db.from('products').select('id, family, subtype, is_security').eq('active', true).order('family'), []),
  ])

  const noHouseholds = households.ok && households.data.length === 0
  const crumb = [{ label: 'FSA', href: '/app' }, { label: 'Policies', href: '/app/policies' }, { label: 'New' }]

  return (
    <FormShell
      title="Record a Policy"
      description="Add an own-book or competitor policy."
      breadcrumb={crumb}
      onSubmitNote="Securities substance is firewall-blocked; only a reference pointer is ever stored."
    >
      {noHouseholds ? (
        <EmptyState
          title="No households yet"
          description="A policy belongs to a household. Add one first."
          action={<Button asChild><Link href="/app/households/new">Add a household</Link></Button>}
        />
      ) : (
        <PolicyForm
          households={households.ok ? households.data : []}
          carriers={carriers.ok ? carriers.data : []}
          products={products.ok ? products.data : []}
          defaultHousehold={searchParams.household}
        />
      )}
    </FormShell>
  )
}
