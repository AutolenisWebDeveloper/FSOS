'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, Send, RotateCcw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ContentReviewActions({
  id,
  status,
  currentVersionId,
}: {
  id: string
  status: string
  currentVersionId: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<{ code: string; message: string }[]>([])
  const [notes, setNotes] = useState('')

  function call(path: string, body?: unknown) {
    setError(null)
    setBlocks([])
    start(async () => {
      const resp = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        if (data.code === 'precheck_failed' && Array.isArray(data.issues)) {
          setBlocks(data.issues)
          setError('This draft cannot move to review until the compliance checks below pass.')
        } else {
          setError(data.error || 'Action failed. Please try again.')
        }
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-shell-border bg-card p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">Review &amp; approval</p>

      {status === 'DRAFT' ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Submitting runs the securities &amp; claims pre-check, then freezes an immutable version for a human reviewer to approve.
          </p>
          <Button size="sm" onClick={() => call(`/api/social/content/${id}/submit`)} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-1 h-4 w-4" aria-hidden />}
            Submit for review
          </Button>
        </div>
      ) : null}

      {status === 'IN_REVIEW' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Approving freezes this version as the record of what was approved. Only an approved version can be scheduled or published.
          </p>
          <div>
            <label htmlFor="review-notes" className="text-xs font-medium text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              id="review-notes"
              className="mt-1 min-h-[64px] w-full rounded-md border border-shell-border bg-background px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => currentVersionId && call(`/api/social/content/${id}/review`, { version_id: currentVersionId, decision: 'approved', notes: notes || undefined })}
              disabled={pending || !currentVersionId}
            >
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />}
              Approve
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => currentVersionId && call(`/api/social/content/${id}/review`, { version_id: currentVersionId, decision: 'changes_requested', notes: notes || undefined })}
              disabled={pending || !currentVersionId}
            >
              Request changes
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => currentVersionId && call(`/api/social/content/${id}/review`, { version_id: currentVersionId, decision: 'rejected', notes: notes || undefined })}
              disabled={pending || !currentVersionId}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      {status === 'APPROVED' ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-status-won">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Approved — ready to schedule.
          </p>
          <p className="text-xs text-muted-foreground">Scheduling &amp; publishing arrive in the next slice. Reopening creates a new version and requires re-approval.</p>
          <Button size="sm" variant="ghost" onClick={() => call(`/api/social/content/${id}/reopen`)} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="mr-1 h-4 w-4" aria-hidden />}
            Reopen for edit
          </Button>
        </div>
      ) : null}

      {status === 'ARCHIVED' ? <p className="text-sm text-muted-foreground">This content was rejected and archived.</p> : null}

      {error ? (
        <div className="mt-3" role="alert">
          <p className="text-sm text-status-lost">{error}</p>
          {blocks.length ? (
            <ul className="mt-2 space-y-1">
              {blocks.map((b, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md border border-status-lost/30 bg-status-lost/5 p-2 text-xs text-status-lost">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{b.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
