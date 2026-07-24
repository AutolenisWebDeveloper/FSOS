'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Convert an ISO instant to the value a datetime-local input expects (local time).
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16)
}

export function QueueEntryActions({ id, scheduledAt }: { id: string; scheduledAt: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [when, setWhen] = useState(() => toLocalInput(scheduledAt))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function reschedule() {
    setError(null)
    startTransition(async () => {
      const resp = await fetch(`/api/social/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scheduled_at: new Date(when).toISOString() }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        setError(body.error || 'Could not reschedule.')
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function cancel() {
    startTransition(async () => {
      const resp = await fetch(`/api/social/schedule/${id}`, { method: 'DELETE' })
      if (resp.ok) router.refresh()
    })
  }

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-8 w-52"
            aria-label="New scheduled time"
          />
          <Button size="sm" onClick={reschedule} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
        {error ? (
          <p className="text-xs text-status-lost" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Reschedule
      </Button>
      <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
        Cancel
      </Button>
    </div>
  )
}
