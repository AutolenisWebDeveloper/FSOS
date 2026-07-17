import { FormShell } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { ReferralForm } from '@/components/app/ReferralForm'

export const dynamic = 'force-dynamic'

// OS-03 Create Referral (A5). `agency` query param prefills the referring agency.
export default async function NewReferralPage(props: { searchParams: Promise<{ agency?: string }> }) {
  const searchParams = await props.searchParams;
  const agencies = await load<{ id: string; agency_name: string }[]>(
    (db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null).order('agency_name'),
    [],
  )
  return (
    <FormShell
      title="Record a Referral"
      description="Capture an inbound agency referral and start the speed-to-lead clock."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Referrals', href: '/app/referrals' }, { label: 'New' }]}
      onSubmitNote="Validated with Zod on submit and again on the server."
    >
      <ReferralForm agencies={agencies.ok ? agencies.data : []} defaultAgency={searchParams.agency} />
    </FormShell>
  )
}
