import { HouseholdProfile } from '@/components/app/HouseholdProfile'

export const dynamic = 'force-dynamic'

export default async function HouseholdProfilePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <HouseholdProfile id={params.id} tab="overview" />
}
