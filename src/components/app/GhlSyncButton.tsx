'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJson, firstFieldError } from '@/lib/client/api'

// Push an App B record (household / agency partnership) into GoHighLevel. Rebuilt
// from App A's per-record "sync to GHL" buttons. Degrades gracefully when GHL is
// not configured (503 → informative toast, no error surface).
export function GhlSyncButton({
  entityType,
  entityId,
  synced,
}: {
  entityType: 'household' | 'agency'
  entityId: string
  synced?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function sync() {
    setBusy(true)
    const res = await postJson<{ ghl_contact_id?: string }>('/api/ghl/sync-record', {
      entity_type: entityType,
      entity_id: entityId,
    })
    setBusy(false)
    if (!res.ok) {
      if (res.error.reason === 'not_configured') {
        toast.info('GoHighLevel isn’t configured yet (set GHL_API_KEY).')
        return
      }
      if (res.error.reason === 'do_not_contact') {
        toast.error('Marked do-not-contact — not synced to GoHighLevel.')
        return
      }
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Synced to GoHighLevel.')
    router.refresh()
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={sync}>
      <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      {busy ? 'Syncing…' : synced ? 'Re-sync GHL' : 'Sync to GHL'}
    </Button>
  )
}
