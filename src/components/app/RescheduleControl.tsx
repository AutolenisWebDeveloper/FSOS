'use client'

// src/components/app/RescheduleControl.tsx
// FSA-side reschedule picker for the appointment detail. Loads real open slots from the
// authenticated /reschedule endpoint (same availability engine as public booking), then requires
// an explicit confirm before moving — because the move updates the meeting and re-notifies the
// client through the existing gate. It never writes directly; the endpoint's shared mover does.

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface Slot {
  startsAt: string
  endsAt: string
}

export function RescheduleControl({ appointmentId }: { appointmentId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [slots, setSlots] = useState<Slot[]>([])
  const [tz, setTz] = useState('America/Chicago')
  const [pending, setPending] = useState<Slot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  const dayKey = useCallback(
    (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso)),
    [tz],
  )
  const timeOf = useCallback(
    (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)),
    [tz],
  )

  async function loadSlots() {
    setLoading(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}/reschedule?days=14`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not load available times')
        return
      }
      setTz(json.timezone || 'America/Chicago')
      setSlots(Array.isArray(json.slots) ? json.slots : [])
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    const next = !open
    setOpen(next)
    setPending(null)
    if (next && slots.length === 0) void loadSlots()
  }

  async function confirmMove() {
    if (!pending) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}/reschedule`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newStartsAt: pending.startsAt }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not reschedule')
      } else {
        toast.success('Appointment rescheduled')
        setOpen(false)
        setPending(null)
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  // Group slots by local day for a scannable picker.
  const groups: { day: string; items: Slot[] }[] = []
  for (const s of slots) {
    const d = dayKey(s.startsAt)
    const last = groups[groups.length - 1]
    if (last && last.day === d) last.items.push(s)
    else groups.push({ day: d, items: [s] })
  }

  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
        {open ? 'Cancel reschedule' : 'Reschedule'}
      </Button>

      {open ? (
        <div className="rounded-lg border p-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading available times…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No open times in the next 14 days. Adjust availability, or cancel and rebook.
            </p>
          ) : pending ? (
            <div className="space-y-3">
              <p className="text-sm">
                Move to <span className="font-medium">{dayKey(pending.startsAt)}</span> at{' '}
                <span className="font-medium">{timeOf(pending.startsAt)}</span>? This updates the meeting and notifies
                the client.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={confirmMove} disabled={submitting}>
                  {submitting ? 'Moving…' : 'Confirm reschedule'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={submitting}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              <p className="text-xs text-muted-foreground">Times shown in {tz.replace(/_/g, ' ')}.</p>
              {groups.map((g) => (
                <div key={g.day}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{g.day}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((s) => (
                      <Button key={s.startsAt} size="sm" variant="outline" onClick={() => setPending(s)}>
                        {timeOf(s.startsAt)}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
