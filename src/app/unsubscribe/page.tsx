import type { Metadata } from 'next'
import Unsubscribe from '@/components/pages/Unsubscribe'

export const metadata: Metadata = { title: 'Unsubscribe — FSOS' }
export const dynamic = 'force-dynamic'

export default function UnsubscribePage() {
  return <Unsubscribe />
}
