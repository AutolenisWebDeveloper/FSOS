import { notFound } from 'next/navigation'
import { AgencyProfile, AGENCY_P0_TABS, type AgencyTab } from '@/components/app/AgencyProfile'

export const dynamic = 'force-dynamic'

// OS-02 Agency Profile tabbed body. Invalid tab param → 404 within the shell.
export default function AgencyTabPage({ params }: { params: { id: string; tab: string } }) {
  if (!AGENCY_P0_TABS.includes(params.tab as AgencyTab)) notFound()
  return <AgencyProfile id={params.id} tab={params.tab as AgencyTab} />
}
