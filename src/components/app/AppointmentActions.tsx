'use client'

// src/components/app/AppointmentActions.tsx
// Client action controls on the appointment detail: add an internal note (feeds the "Missing notes"
// KPI + the timeline) and create a single follow-up task (feeds "Follow-ups due"). Both are
// green-zone internal writes through the narrow /note and /task endpoints — they contact no one.
// Mirrors AppointmentStatusControls (fetch → toast → router.refresh).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

// Friendly copy for a gate/notify outcome that didn't send (the send path returns a reason).
const SEND_REASONS: Record<string, string> = {
  no_email: 'No email on file for this contact.',
  no_start: 'This appointment has no scheduled time.',
  not_found: 'Appointment not found.',
  template_not_approved: 'The confirmation template isn’t approved yet.',
  gate_blocked: 'Held by the compliance gate (consent, quiet hours, or DNC).',
}

export function AppointmentActions({ appointmentId }: { appointmentId: string }) {
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [sendConfirm, setSendConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const router = useRouter()

  async function saveNote() {
    const body = note.trim()
    if (!body) return
    setSavingNote(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not save the note')
      } else {
        toast.success('Note added')
        setNote('')
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSavingNote(false)
    }
  }

  async function createTask() {
    setCreatingTask(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not create the task')
      } else {
        toast.success(json.deduped ? 'An open follow-up task already exists' : 'Follow-up task created')
        router.refresh()
      }
    } catch {
      toast.error('Network error')
    } finally {
      setCreatingTask(false)
    }
  }

  async function sendConfirmation() {
    setSending(true)
    try {
      const res = await fetch(`/api/app/appointments/${appointmentId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'confirmation' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not send the communication')
      } else if (json.sent) {
        toast.success('Confirmation email sent')
        setSendConfirm(false)
        router.refresh()
      } else {
        // A legitimate gate decision — not sent, with a reason.
        toast.warning(SEND_REASONS[json.reason as string] || `Not sent (${json.reason ?? 'held by the gate'}).`)
        setSendConfirm(false)
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label htmlFor="appt-note" className="text-sm font-medium">
          Add a note
        </label>
        <Textarea
          id="appt-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Internal note — visible to your team, never sent to the client."
          rows={3}
          maxLength={2000}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={saveNote} disabled={savingNote || note.trim().length === 0}>
            {savingNote ? 'Saving…' : 'Save note'}
          </Button>
          <Button size="sm" variant="outline" onClick={createTask} disabled={creatingTask}>
            {creatingTask ? 'Creating…' : 'Create follow-up task'}
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t pt-3">
        <p className="text-sm font-medium">Send approved communication</p>
        <p className="text-xs text-muted-foreground">
          Re-sends the approved confirmation email through the compliance gate (consent, quiet hours, and DNC are
          enforced — a blocked send is reported, never forced).
        </p>
        {sendConfirm ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Send the confirmation email to the client?</span>
            <Button size="sm" onClick={sendConfirmation} disabled={sending}>
              {sending ? 'Sending…' : 'Send confirmation'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSendConfirm(false)} disabled={sending}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setSendConfirm(true)}>
            Resend confirmation
          </Button>
        )}
      </div>
    </div>
  )
}
