'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Resolution controls for one escalation. These record a human decision only —
// they NEVER send a client-facing message. Securities items expose no send path.
export function EscalationActions({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)

  async function decide(decision: 'handled' | 'dismissed' | 'reassigned') {
    setBusy(decision)
    const res = await patchJson(`/api/ai/escalations/${id}`, { decision })
    setBusy(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(
      decision === 'handled' ? 'Escalation marked handled' : decision === 'dismissed' ? 'Escalation dismissed' : 'Escalation reassigned',
    )
    router.refresh()
  }

  if (resolved) {
    return <span className="text-sm text-muted-foreground">Resolved — no further action.</span>
  }

  return (
    <>
      <Button disabled={busy !== null} onClick={() => decide('handled')}>
        {busy === 'handled' ? '…' : 'Mark handled'}
      </Button>
      <Button variant="outline" disabled={busy !== null} onClick={() => decide('dismissed')}>
        {busy === 'dismissed' ? '…' : 'Dismiss'}
      </Button>
      <Button variant="outline" disabled={busy !== null} onClick={() => decide('reassigned')}>
        {busy === 'reassigned' ? '…' : 'Reassign'}
      </Button>
    </>
  )
}
