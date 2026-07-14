import { HouseholdProfile } from '@/components/app/HouseholdProfile'

export const dynamic = 'force-dynamic'

export default function HouseholdProfilePage({ params }: { params: { id: string } }) {
  return <HouseholdProfile id={params.id} tab="overview" />
}
