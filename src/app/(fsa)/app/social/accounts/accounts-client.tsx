'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Live connection health check — decrypts + (for YouTube) refreshes the token
// server-side, pings the provider, and records health. No token ever reaches here.
export function VerifyChannel({ id, platformLabel }: { id: string; platformLabel: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function verify() {
    setMsg(null)
    startTransition(async () => {
      const resp = await fetch(`/api/social/channels/${id}/verify`, { method: 'POST' })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setMsg(body.error || 'Could not check the connection.')
        return
      }
      setMsg(body.healthy ? 'Connection healthy.' : 'Connection needs attention — see status.')
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={verify} disabled={pending}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />}
        Check health
      </Button>
      {msg ? (
        <span className="text-xs text-muted-foreground" role="status">
          {msg}
        </span>
      ) : (
        <span className="sr-only">Check the {platformLabel} connection health</span>
      )}
    </div>
  )
}

export function DisconnectChannel({ id, platformLabel }: { id: string; platformLabel: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function disconnect() {
    startTransition(async () => {
      const resp = await fetch(`/api/social/channels/${id}`, { method: 'DELETE' })
      if (resp.ok) router.refresh()
      setConfirming(false)
    })
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Disconnect
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Disconnect {platformLabel}?</span>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Cancel
      </Button>
      <Button variant="destructive" size="sm" onClick={disconnect} disabled={pending}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
        Confirm
      </Button>
    </div>
  )
}
