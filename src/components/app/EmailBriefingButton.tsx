'use client'

import * as React from 'react'
import { Mail, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// "Email me this briefing" (docs/legacy-port.md §2.10). The send routes through the
// comms dispatcher gate server-side; a gate block is surfaced, never a silent send.
export function EmailBriefingButton() {
  const [busy, setBusy] = React.useState(false)

  async function onClick() {
    setBusy(true)
    const res = await postJson<{ sent?: boolean; blocked?: boolean; reason?: string }>('/api/briefing/email')
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    if (res.data.blocked) {
      toast.warning(`Not sent — ${res.data.reason ?? 'blocked by the comms gate'}. Logged and escalated.`)
      return
    }
    toast.success('Briefing emailed to you.')
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />}
      Email me this briefing
    </Button>
  )
}
