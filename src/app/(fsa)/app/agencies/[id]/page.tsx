import { AgencyProfile } from '@/components/app/AgencyProfile'

export const dynamic = 'force-dynamic'

// OS-02 Agency Profile shell (A3) — default overview tab.
export default async function AgencyProfilePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <AgencyProfile id={params.id} tab="overview" />
}
