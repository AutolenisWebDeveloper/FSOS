'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Publish / complete / cancel a workshop (docs/legacy-port.md §2.5). Publishing
// opens the public registration link.
export function WorkshopStatusControl({ workshopId, status }: { workshopId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function setStatus(next: string, msg: string) {
    setBusy(true)
    const res = await patchJson(`/api/workshops/${workshopId}`, { status: next })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(msg)
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-shell-muted" aria-hidden /> : null}
      {status === 'draft' ? (
        <Button size="sm" onClick={() => setStatus('published', 'Workshop published.')} disabled={busy}>
          Publish
        </Button>
      ) : null}
      {status === 'published' ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('completed', 'Marked completed.')} disabled={busy}>
          Mark completed
        </Button>
      ) : null}
      {status !== 'cancelled' && status !== 'completed' ? (
        <Button size="sm" variant="outline" onClick={() => setStatus('cancelled', 'Workshop cancelled.')} disabled={busy}>
          Cancel
        </Button>
      ) : null}
    </div>
  )
}
