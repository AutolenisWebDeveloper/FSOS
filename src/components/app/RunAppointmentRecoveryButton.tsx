'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// Client action: sweep no-show appointments and create one internal reschedule
// follow-up task per un-recovered no-show. Creates internal tasks only — nothing is
// sent to a client here. Server-side auth + dedup apply.
export function RunAppointmentRecoveryButton() {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/app/appointments/recovery', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not run no-show recovery')
      } else if (json.created > 0) {
        toast.success(`${json.created} recovery task${json.created === 1 ? '' : 's'} created`)
        router.refresh()
      } else {
        toast.info(json.note || 'No new recovery tasks — no-shows are already handled')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button onClick={run} disabled={busy} size="sm">
      {busy ? 'Recovering…' : 'Run no-show recovery'}
    </Button>
  )
}
