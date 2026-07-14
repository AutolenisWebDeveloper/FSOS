import { AgencyProfile } from '@/components/app/AgencyProfile'

export const dynamic = 'force-dynamic'

// OS-02 Agency Profile shell (A3) — default overview tab.
export default function AgencyProfilePage({ params }: { params: { id: string } }) {
  return <AgencyProfile id={params.id} tab="overview" />
}
