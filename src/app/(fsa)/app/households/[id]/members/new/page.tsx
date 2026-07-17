import { notFound } from 'next/navigation'
import { FormShell } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { MemberForm } from '@/components/app/MemberForm'

export const dynamic = 'force-dynamic'

// OS-04 Add Member (A5). DOB is encrypted at rest.
export default async function NewMemberPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const hh = await load<{ primary_name: string } | null>(
    (db) => db.from('households').select('primary_name').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (hh.ok && hh.data === null) notFound()
  const name = hh.ok ? hh.data?.primary_name ?? 'Household' : 'Household'
  return (
    <FormShell
      title="Add Member"
      description="Add a person to this household."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Households', href: '/app/households' }, { label: name, href: `/app/households/${params.id}` }, { label: 'Add member' }]}
      onSubmitNote="Date of birth is encrypted with pgcrypto; only permitted roles can decrypt it, and every view is audited."
    >
      <MemberForm householdId={params.id} />
    </FormShell>
  )
}
