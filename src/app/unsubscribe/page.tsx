import type { Metadata } from 'next'
import Unsubscribe from '@/components/pages/Unsubscribe'

export const metadata: Metadata = { title: 'Unsubscribe — FSOS' }
export const dynamic = 'force-dynamic'

// Prefilled from the emailed footer link / one-click redirect (?c=&ch=&done=1). Read
// server-side and passed as props so the client component needs no useSearchParams
// (avoids a CSR bailout at build).
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams?: Promise<{ c?: string; ch?: string; done?: string }>
}) {
  const sp = (await searchParams) ?? {}
  const channel = sp.ch === 'email' || sp.ch === 'sms' ? sp.ch : 'all'
  return (
    <Unsubscribe
      initialContact={sp.c ?? ''}
      initialChannel={channel}
      initialDone={sp.done === '1'}
    />
  )
}
