import { notFound } from 'next/navigation'
import { HouseholdProfile, HOUSEHOLD_P0_TABS, type HouseholdTab } from '@/components/app/HouseholdProfile'

export const dynamic = 'force-dynamic'

export default async function HouseholdTabPage(props: { params: Promise<{ id: string; tab: string }> }) {
  const params = await props.params;
  if (!HOUSEHOLD_P0_TABS.includes(params.tab as HouseholdTab)) notFound()
  return <HouseholdProfile id={params.id} tab={params.tab as HouseholdTab} />
}
