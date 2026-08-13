'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { ModalShell } from '@/components/archetypes'
import { postJson, getJson, firstFieldError } from '@/lib/client/api'

export interface AgencyCommunicationsControlProps {
  agencyId: string
  initialStatus: 'active' | 'blocked'
  /** Live book size (assigned Contact Center clients). */
  bookCount: number
  reason?: string | null
  blockedAt?: string | null
  /** Whether the viewer may mutate suppression (server-authorized; hides the control otherwise). */
  canManage: boolean
}

/**
 * Client Communications control on the agent (agency) profile. Toggles agent-level BUSINESS
 * suppression — excluding the agent's whole book from applicable NON-transactional outreach.
 * Blocking requires an explicit confirmation + reason and shows the affected-client count
 * first. This is deliberately distinct from regulatory DNC/consent: the copy makes clear that
 * unblocking restores business eligibility only — regulatory opt-outs still apply.
 */
export function AgencyCommunicationsControl({
  agencyId,
  initialStatus,
  bookCount,
  reason,
  blockedAt,
  canManage,
}: AgencyCommunicationsControlProps) {
  const router = useRouter()
  const [status, setStatus] = React.useState(initialStatus)
  const [open, setOpen] = React.useState(false)
  const [count, setCount] = React.useState(bookCount)
  const [reasonText, setReasonText] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const blocked = status === 'blocked'
  const nextStatus: 'active' | 'blocked' = blocked ? 'active' : 'blocked'

  async function openDialog() {
    setReasonText('')
    setOpen(true)
    // Refresh the affected-client count at confirm time (the book may have changed).
    const res = await getJson<{ book_count: number }>(`/api/app/comms/suppression?agencyId=${agencyId}`)
    if (res.ok && typeof res.data.book_count === 'number') setCount(res.data.book_count)
  }

  async function apply() {
    if (nextStatus === 'blocked' && reasonText.trim().length < 3) {
      toast.error('A reason is required to block communications.')
      return
    }
    setBusy(true)
    const res = await postJson('/api/app/comms/suppression', {
      scope: 'agency',
      agencyId,
      status: nextStatus,
      reason: reasonText.trim() || undefined,
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message || res.error.reason || 'Could not update communications.')
      return
    }
    setStatus(nextStatus)
    setOpen(false)
    toast.success(
      nextStatus === 'blocked'
        ? 'Client communications blocked for this agent.'
        : 'Client communications reactivated for this agent.',
    )
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status</span>
            {blocked ? (
              <Badge variant="blocked">Blocked</Badge>
            ) : (
              <Badge variant="active">Active</Badge>
            )}
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            {blocked
              ? 'Clients assigned to this agent are excluded from applicable non-transactional FSOS outreach (campaigns, marketing email/SMS, automated and AI-initiated communications). Transactional and requested servicing messages are unaffected.'
              : 'Clients may receive eligible FSOS communications according to their individual consent and communication restrictions.'}
          </p>
          {blocked && reason ? (
            <p className="text-xs text-muted-foreground">
              Reason: <span className="text-foreground">{reason}</span>
              {blockedAt ? <> · since {new Date(blockedAt).toLocaleDateString('en-US')}</> : null}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <Button variant={blocked ? 'outline' : 'destructive'} size="sm" onClick={openDialog}>
            {blocked ? 'Reactivate communications' : 'Block communications'}
          </Button>
        ) : null}
      </div>

      <ModalShell
        open={open}
        onOpenChange={setOpen}
        title={blocked ? 'Reactivate client communications?' : 'Block communications for this agent?'}
        description={
          blocked
            ? 'Restores business eligibility only. Any existing regulatory restriction (do-not-contact, unsubscribe, consent revocation) still applies and is not reactivated.'
            : `${count} client${count === 1 ? '' : 's'} will be excluded from applicable campaigns, marketing email, SMS, automated outreach, and AI-initiated communications. Transactional and requested servicing messages are unaffected.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={blocked ? 'default' : 'destructive'} onClick={apply} disabled={busy}>
              {busy ? 'Saving…' : blocked ? 'Reactivate' : `Block ${count} client${count === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="suppression_reason" label="Reason" required={!blocked}>
            <Textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder={
                blocked ? 'Optional note for the audit record…' : 'Why are you blocking this agent’s book? (recorded in the audit log)'
              }
            />
          </Field>
        </div>
      </ModalShell>
    </div>
  )
}
