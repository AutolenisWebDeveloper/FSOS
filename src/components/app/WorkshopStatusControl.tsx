'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Workshop lifecycle control (spec §8). The publish path is HARD-GATED: an FSA can move a
// draft into compliance review, but only a compliance-approved workshop exposes the
// Publish button — and publishing still re-checks the gate server-side (approval +
// approved disclosure). There is NO force-publish path.
export function WorkshopStatusControl({ workshopId, status }: { workshopId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  async function setStatus(next: string, msg: string) {
    setBusy(true)
    const res = await patchJson(`/api/workshops/${workshopId}`, { status: next })
    setBusy(false)
    if (!res.ok) {
      // Surfaces the publish-gate reason (422) verbatim so the blocker is legible.
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
        <Button size="sm" onClick={() => setStatus('pending_review', 'Sent for compliance review.')} disabled={busy}>
          Submit for compliance review
        </Button>
      ) : null}

      {status === 'pending_review' ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-status-pending/30 bg-status-pending/10 px-2.5 py-1 text-xs font-medium text-status-pending">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Awaiting compliance approval
          </span>
          <Button size="sm" variant="outline" onClick={() => setStatus('draft', 'Withdrawn to draft.')} disabled={busy}>
            Withdraw
          </Button>
        </>
      ) : null}

      {status === 'compliance_approved' ? (
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
