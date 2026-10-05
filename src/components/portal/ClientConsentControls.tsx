'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// P-5 consent controls. Revocation is immediate and global (updates consents + DNC).
export function ClientConsentControls({ channels }: { channels: { channel: string; status: string }[] }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  // Set when texts were turned back on for a number whose last opt-out was a STOP: the carrier keeps
  // blocking it until that phone texts START, whatever is recorded here (owner, round 4).
  const [startNumber, setStartNumber] = React.useState<string | null>(null)

  async function set(channel: string, status: 'granted' | 'revoked') {
    setBusy(channel)
    const res = await postJson<{ ok: true; textStart?: { number: string } }>('/api/client/consent', { channel, status })
    setBusy(null)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    const needStart = channel === 'sms' && status === 'granted' ? res.data?.textStart?.number ?? null : null
    setStartNumber(needStart)
    if (status === 'revoked') toast.success('Opted out — honored immediately across all channels.')
    else if (needStart) toast.success('Saved. One more step to finish turning texts back on — see below.')
    else toast.success('Consent granted.')
    router.refresh()
  }

  const all = ['sms', 'email', 'call']
  const statusOf = (c: string) => channels.find((x) => x.channel === c)?.status ?? 'none'

  return (
    <div className="space-y-2">
      {all.map((c) => {
        const s = statusOf(c)
        return (
          <div key={c} className="flex items-center justify-between rounded-md border p-3 text-sm">
            <span className="capitalize">{c} — <span className={s === 'granted' ? 'text-status-won' : 'text-muted-foreground'}>{s}</span></span>
            {s === 'granted' ? (
              <Button size="sm" variant="outline" onClick={() => set(c, 'revoked')} disabled={busy === c}>Opt out</Button>
            ) : (
              <Button size="sm" onClick={() => set(c, 'granted')} disabled={busy === c}>Opt in</Button>
            )}
          </div>
        )
      })}
      {startNumber && (
        <div role="status" className="rounded-md border border-status-pending/40 bg-status-pending/10 p-3 text-sm text-foreground">
          <p className="font-medium">Text START to {startNumber} to finish.</p>
          <p className="mt-1 text-muted-foreground">
            You previously replied STOP, so your mobile carrier keeps our texts blocked until your phone sends START
            to {startNumber}. Until then you won&apos;t receive texts from us, even though your preference is saved.
          </p>
        </div>
      )}
    </div>
  )
}
