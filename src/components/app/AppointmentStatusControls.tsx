'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// Client control for triaging an overdue appointment: mark it held (completed) or a
// no-show. Green-zone: it advances an internal record via the validated state machine
// and audits it — it sends nothing.
export function AppointmentStatusControls({ appointmentId }: { appointmentId: string }) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function set(status: 'completed' | 'no_show') {
    setBusy(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Could not update the appointment')
      } else {
        toast.success(status === 'completed' ? 'Marked held' : 'Marked no-show')
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button onClick={() => set('completed')} disabled={busy} size="sm" variant="outline">
        Held
      </Button>
      <Button onClick={() => set('no_show')} disabled={busy} size="sm" variant="outline">
        No-show
      </Button>
    </div>
  )
}
