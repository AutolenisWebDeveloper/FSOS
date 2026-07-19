import type { Metadata } from 'next'
import EventsIndex from '@/components/pages/EventsIndex'

export const metadata: Metadata = { title: 'Upcoming Workshops — FSOS' }
export const dynamic = 'force-dynamic'

export default function EventsPage() {
  return <EventsIndex />
}
