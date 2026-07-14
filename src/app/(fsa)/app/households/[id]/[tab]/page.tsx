import { notFound } from 'next/navigation'
import { HouseholdProfile, HOUSEHOLD_P0_TABS, type HouseholdTab } from '@/components/app/HouseholdProfile'

export const dynamic = 'force-dynamic'

export default function HouseholdTabPage({ params }: { params: { id: string; tab: string } }) {
  if (!HOUSEHOLD_P0_TABS.includes(params.tab as HouseholdTab)) notFound()
  return <HouseholdProfile id={params.id} tab={params.tab as HouseholdTab} />
}
