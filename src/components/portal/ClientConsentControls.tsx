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

  async function set(channel: string, status: 'granted' | 'revoked') {
    setBusy(channel)
    const res = await postJson('/api/client/consent', { channel, status })
    setBusy(null)
    if (!res.ok) { toast.error(firstFieldError(res.error).message); return }
    toast.success(status === 'revoked' ? 'Opted out — honored immediately across all channels.' : 'Consent granted.')
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
    </div>
  )
}
