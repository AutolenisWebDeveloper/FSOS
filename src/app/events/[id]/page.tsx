import WorkshopRegister from '@/components/pages/WorkshopRegister'

// Public route — no auth required
export const dynamic = 'force-dynamic'

interface EventPageProps {
  params: { id: string }
}

export default function EventPage({ params }: EventPageProps) {
  return <WorkshopRegister workshopId={params.id} />
}
