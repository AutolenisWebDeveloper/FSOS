import { FormShell } from '@/components/archetypes'
import { PartnerReferForm } from '@/components/portal/PartnerReferForm'

export const dynamic = 'force-dynamic'

// P-4 Submit Referral (A5).
export default function PartnerReferPage() {
  return (
    <FormShell title="Submit a Referral" description="Refer a client to your Farmers FSA. Attribution and SLA start immediately." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Submit Referral' }]}>
      <PartnerReferForm />
    </FormShell>
  )
}
