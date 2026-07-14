'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/forms/Field'
import { ModalShell } from '@/components/archetypes'
import { REFERRAL_LOSS_REASONS } from '@/lib/validation/schemas'
import { postJson, firstFieldError } from '@/lib/client/api'

export function ReferralActions({
  id,
  status,
  canConvert,
}: {
  id: string
  status: string
  canConvert: boolean
}) {
  const router = useRouter()
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [reason, setReason] = React.useState<string>(REFERRAL_LOSS_REASONS[0])
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const closed = status === 'converted' || status === 'declined'

  async function reject() {
    setBusy(true)
    const res = await postJson(`/api/referrals/${id}/reject`, { loss_reason: reason, note: note || undefined })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Referral declined')
    setRejectOpen(false)
    router.refresh()
  }

  if (closed) {
    return (
      <span className="text-sm text-muted-foreground">
        {status === 'converted' ? 'Converted' : 'Declined'} — no further action.
      </span>
    )
  }

  return (
    <>
      <Button asChild disabled={!canConvert} variant={canConvert ? 'default' : 'outline'}>
        <Link
          href={canConvert ? `/app/referrals/${id}/convert` : '#'}
          aria-disabled={!canConvert}
          onClick={(e) => {
            if (!canConvert) {
              e.preventDefault()
              toast.error('Add a referred name before converting.')
            }
          }}
        >
          Convert
        </Link>
      </Button>
      <Button variant="outline" onClick={() => setRejectOpen(true)}>
        Reject
      </Button>

      <ModalShell
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject referral"
        description="Records a loss reason and marks the referral declined."
        footer={
          <>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={reject} disabled={busy}>{busy ? 'Rejecting…' : 'Reject referral'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="loss_reason" label="Loss reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REFERRAL_LOSS_REASONS.map((r) => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </Field>
          <Field id="reject_note" label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional context…" />
          </Field>
        </div>
      </ModalShell>
    </>
  )
}
