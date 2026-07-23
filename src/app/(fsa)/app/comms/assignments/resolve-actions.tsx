'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

// Resolve / dismiss controls for one assignment-review item (Slice 1, §6). Posts the
// authorized decision to /api/comms/assignments/[id] and refreshes the list. Errors are
// surfaced inline (never swallowed); the buttons are disabled while in flight to prevent
// duplicate submission (§13.3).
export function ResolveActions({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'resolve' | 'dismiss'>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'resolve' | 'dismiss') {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/comms/assignments/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Could not update this review. Please try again.')
        setBusy(null)
        return
      }
      router.refresh()
    } catch {
      setError('Network error — please try again.')
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act('dismiss')}>
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </Button>
        <Button size="sm" disabled={busy !== null} onClick={() => act('resolve')}>
          {busy === 'resolve' ? 'Resolving…' : 'Mark resolved'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}
