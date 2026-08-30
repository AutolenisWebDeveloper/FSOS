'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, Circle, ListPlus, RotateCcw, Sparkles, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModalShell } from '@/components/archetypes/overlays'
import { EmptyState } from '@/components/archetypes/states'
import { patchJson, postJson, firstFieldError } from '@/lib/client/api'
import { cn } from '@/lib/utils'
import { dueBucket, relativeDay, type DueBucket, type TaskRow } from '@/lib/contacts/record-view'

/*
 * Tasks, worked in place. §11 of the redesign brief: an overdue task must expose
 * its completion control where the FSA sees it, not four clicks away. Complete /
 * reopen / reschedule all go through the existing RBAC-gated
 * PATCH /api/work-tasks/[id]; creation through POST /api/work-tasks. No new
 * endpoint, no new task semantics.
 */

const BUCKET_STYLE: Record<DueBucket, { chip: string; rail: string; word: string }> = {
  overdue: { chip: 'text-status-lost', rail: 'bg-status-lost', word: 'Overdue' },
  today: { chip: 'text-status-pending', rail: 'bg-status-pending', word: 'Due today' },
  soon: { chip: 'text-muted-foreground', rail: 'bg-border', word: 'Due' },
  later: { chip: 'text-muted-foreground', rail: 'bg-border', word: 'Due' },
  none: { chip: 'text-muted-foreground', rail: 'bg-border', word: 'No due date' },
}

const SOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  agent: Sparkles,
  workflow: Workflow,
}

export function ContactTaskRow({ task, dense = false }: { task: TaskRow; dense?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const bucket = dueBucket(task.due_at)
  const style = BUCKET_STYLE[bucket]
  const SourceIcon = task.source ? SOURCE_ICON[task.source] : undefined

  async function toggle() {
    setBusy(true)
    const res = await patchJson(`/api/work-tasks/${task.id}`, { completed: !task.completed })
    setBusy(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success(task.completed ? 'Task reopened' : 'Task completed')
    router.refresh()
  }

  return (
    <li
      className={cn(
        'group relative flex items-start gap-3 py-2.5 pl-3 pr-1 transition-colors duration-fast hover:bg-sunken/60',
        dense ? 'text-[13px]' : 'text-sm',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-1 left-0 w-0.5 rounded-full', task.completed ? 'bg-transparent' : style.rail)}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={task.completed ? `Reopen task: ${task.title}` : `Complete task: ${task.title}`}
        className={cn(
          'mt-0.5 shrink-0 rounded-full text-muted-foreground transition-colors duration-fast',
          'hover:text-status-won focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          task.completed && 'text-status-won',
          busy && 'opacity-50',
        )}
      >
        {task.completed ? <CheckCircle2 className="h-[18px] w-[18px]" /> : <Circle className="h-[18px] w-[18px]" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium leading-snug', task.completed && 'text-muted-foreground line-through')}>
          {task.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {task.due_at ? (
            <span className={cn('numeric font-medium', task.completed ? 'text-muted-foreground' : style.chip)}>
              {style.word} · {relativeDay(task.due_at)}
            </span>
          ) : (
            <span>No due date</span>
          )}
          {SourceIcon ? (
            <span className="inline-flex items-center gap-1">
              <SourceIcon className="h-3 w-3" aria-hidden /> {task.source === 'agent' ? 'AI-generated' : 'Workflow'}
            </span>
          ) : null}
          {task.entity_type === 'household' ? <span>Household task</span> : null}
        </p>
      </div>
      {task.completed ? (
        <RotateCcw className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      ) : null}
    </li>
  )
}

export function ContactTaskList({
  contactId,
  tasks,
  dense = false,
  emptyTitle = 'No open tasks',
  emptyDescription = 'Create one so the next step on this contact is never carried in your head.',
  showComposer = true,
}: {
  contactId: string
  tasks: TaskRow[]
  dense?: boolean
  emptyTitle?: string
  emptyDescription?: string
  showComposer?: boolean
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListPlus}
        title={emptyTitle}
        description={emptyDescription}
        action={showComposer ? <ContactTaskComposer contactId={contactId} /> : undefined}
      />
    )
  }
  return (
    <ul className="divide-y">
      {tasks.map((t) => (
        <ContactTaskRow key={t.id} task={t} dense={dense} />
      ))}
    </ul>
  )
}

export function ContactTaskComposer({
  contactId,
  className,
  variant = 'outline',
  size = 'sm',
  label = 'Add task',
}: {
  contactId: string
  className?: string
  variant?: 'outline' | 'default' | 'ghost'
  size?: 'sm' | 'default'
  label?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [due, setDue] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const id = React.useId()

  async function save() {
    const t = title.trim()
    if (!t) {
      toast.error('Give the task a title')
      return
    }
    setSaving(true)
    const res = await postJson('/api/work-tasks', {
      title: t,
      entity_type: 'contact',
      entity_id: contactId,
      ...(due ? { due_at: new Date(`${due}T12:00:00`).toISOString() } : {}),
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Task created')
    setTitle('')
    setDue('')
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <ListPlus className="h-4 w-4" /> {label}
      </Button>
      <ModalShell
        open={open}
        onOpenChange={setOpen}
        title="Add task"
        description="Tracked against this contact and surfaced on your task queue."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving} disabled={saving}>
              Create task
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-title`}>Task</Label>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Send the conversion illustration"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-due`}>
              Due date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <Input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-[11rem]" />
            </div>
          </div>
        </div>
      </ModalShell>
    </>
  )
}
