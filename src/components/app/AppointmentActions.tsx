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

export function AppointmentActions({ appointmentId }: { appointmentId: string }) {
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
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
    </div>
  )
}
