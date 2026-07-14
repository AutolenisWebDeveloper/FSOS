'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/forms/Field'
import { patchJson, firstFieldError } from '@/lib/client/api'

/** A3 detail actions for a work task: complete + reschedule due date. */
export function TaskActions({
  taskId,
  completed,
  dueAt,
}: {
  taskId: string
  completed: boolean
  dueAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [due, setDue] = React.useState(dueAt ? dueAt.slice(0, 10) : '')

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    const res = await patchJson(`/api/work-tasks/${taskId}`, body)
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success(okMsg)
    router.refresh()
  }

  async function reschedule() {
    if (!due) {
      toast.error('Pick a date')
      return
    }
    await patch({ due_at: new Date(`${due}T12:00:00`).toISOString() }, 'Task rescheduled')
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
      {!completed ? (
        <Button onClick={() => patch({ completed: true }, 'Task completed')} disabled={busy}>
          Mark complete
        </Button>
      ) : (
        <Button variant="outline" onClick={() => patch({ completed: false }, 'Task reopened')} disabled={busy}>
          Reopen task
        </Button>
      )}
      <div className="flex items-end gap-2">
        <Field id="task-due" label="Reschedule">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-[10rem]" />
        </Field>
        <Button variant="outline" onClick={reschedule} disabled={busy}>
          Update date
        </Button>
      </div>
    </div>
  )
}
