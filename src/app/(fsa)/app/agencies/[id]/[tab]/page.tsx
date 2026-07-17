import { notFound } from 'next/navigation'
import { AgencyProfile, AGENCY_TABS, type AgencyTab } from '@/components/app/AgencyProfile'

export const dynamic = 'force-dynamic'

// OS-02 Agency Profile tabbed body. Invalid tab param → 404 within the shell.
export default async function AgencyTabPage(props: { params: Promise<{ id: string; tab: string }> }) {
  const params = await props.params;
  if (!AGENCY_TABS.includes(params.tab as AgencyTab)) notFound()
  return <AgencyProfile id={params.id} tab={params.tab as AgencyTab} />
}
