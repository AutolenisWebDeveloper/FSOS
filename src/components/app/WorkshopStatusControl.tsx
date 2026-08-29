'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/archetypes/overlays'
import { patchJson, firstFieldError } from '@/lib/client/api'

// Workshop lifecycle control (spec §8). The publish path is HARD-GATED: an FSA can move a
// draft into compliance review, but only a compliance-approved workshop exposes the
// Publish button — and publishing still re-checks the gate server-side (approval +
// approved disclosure). There is NO force-publish path.
export function WorkshopStatusControl({ workshopId, status }: { workshopId: string; status: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [confirmCancel, setConfirmCancel] = React.useState(false)

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
        <Button size="sm" onClick={() => setStatus('pending_review', 'Submitted for your approval.')} disabled={busy}>
          Submit for approval
        </Button>
      ) : null}

      {status === 'pending_review' ? (
        <>
          <Link
            href="/app/workshops/review"
            className="inline-flex items-center gap-1.5 rounded-md border border-status-pending/30 bg-status-pending/10 px-2.5 py-1 text-xs font-medium text-status-pending hover:bg-status-pending/20"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Awaiting your approval
          </Link>
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

      {/* WS-053: cancelling is DESTRUCTIVE and registrant-affecting — it notifies
          everyone registered, pulls the public page, and is terminal (reopening to
          draft voids the compliance approval). It gets a confirmation, per DESIGN §7. */}
      {status !== 'cancelled' && status !== 'completed' ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)} disabled={busy}>
            Cancel workshop
          </Button>
          <ConfirmDialog
            open={confirmCancel}
            onOpenChange={setConfirmCancel}
            title="Cancel this workshop?"
            consequence={
              status === 'published'
                ? 'Everyone already registered will be sent a cancellation notice, the public registration page closes immediately, and any Zoom links are deleted. Cancelling is terminal: reopening it to draft voids the compliance approval, so republishing needs a fresh one.'
                : 'The workshop moves to cancelled. This is terminal: reopening it to draft voids any compliance approval, so republishing needs a fresh one.'
            }
            confirmLabel="Cancel workshop"
            destructive
            pending={busy}
            onConfirm={async () => {
              await setStatus('cancelled', 'Workshop cancelled.')
              setConfirmCancel(false)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
