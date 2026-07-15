'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckSquare, Check } from 'lucide-react'
import { MonoLabel, Numeric } from '@/components/ui/typography'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/archetypes'
import { patchJson, firstFieldError } from '@/lib/client/api'

export interface TaskRow {
  id: string
  title: string
  entity_type: string | null
  entity_id: string | null
  source: string
  due_at: string | null
  completed: boolean
}

const DUE_BUCKETS = ['overdue', 'today', 'upcoming'] as const
type DueBucket = (typeof DUE_BUCKETS)[number]

/** Deep-link a task to its source record; null when the type has no known route. */
function taskHref(t: TaskRow): string | null {
  if (!t.entity_type || !t.entity_id) return null
  switch (t.entity_type) {
    case 'agency_partnership':
      return `/app/agencies/${t.entity_id}`
    case 'referral':
      return `/app/referrals/${t.entity_id}`
    case 'household':
      return `/app/households/${t.entity_id}`
    case 'opportunity':
      return `/app/opportunities/${t.entity_id}`
    case 'policy':
      return `/app/policies/${t.entity_id}`
    default:
      return null
  }
}

function bucketOf(t: TaskRow): DueBucket {
  if (!t.due_at) return 'upcoming'
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const due = new Date(t.due_at)
  if (due < start) return 'overdue'
  if (due < end) return 'today'
  return 'upcoming'
}

const BUCKET_LABEL: Record<DueBucket, string> = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming' }

export function TaskList({ rows }: { rows: TaskRow[] }) {
  const router = useRouter()
  const [dueFilter, setDueFilter] = React.useState<DueBucket | ''>('')
  const [sourceFilter, setSourceFilter] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  const sources = React.useMemo(() => Array.from(new Set(rows.map((r) => r.source))).sort(), [rows])

  const filtered = React.useMemo(() => {
    let r = rows
    if (sourceFilter) r = r.filter((t) => t.source === sourceFilter)
    return r
  }, [rows, sourceFilter])

  const open = filtered.filter((t) => !t.completed)
  const completed = filtered.filter((t) => t.completed)

  const grouped: Record<DueBucket, TaskRow[]> = { overdue: [], today: [], upcoming: [] }
  for (const t of open) grouped[bucketOf(t)].push(t)

  async function complete(id: string) {
    setBusy(id)
    const res = await patchJson(`/api/work-tasks/${id}`, { completed: true })
    setBusy(null)
    if (!res.ok) {
      toast.error(firstFieldError(res.error).message)
      return
    }
    toast.success('Task completed')
    router.refresh()
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="No tasks yet"
        description="Tasks you create or that workflows and agents generate will appear here."
        action={
          <Button asChild>
            <Link href="/app/calendar">View calendar</Link>
          </Button>
        }
      />
    )
  }

  const visibleBuckets = dueFilter ? DUE_BUCKETS.filter((b) => b === dueFilter) : DUE_BUCKETS
  const showCompleted = !dueFilter

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Task filters">
        <FilterChip active={dueFilter === ''} onClick={() => setDueFilter('')}>
          All
        </FilterChip>
        {DUE_BUCKETS.map((b) => (
          <FilterChip key={b} active={dueFilter === b} onClick={() => setDueFilter(b)}>
            {BUCKET_LABEL[b]}
          </FilterChip>
        ))}
        {sources.length > 1 ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FilterChip active={sourceFilter === ''} onClick={() => setSourceFilter('')}>
              Any source
            </FilterChip>
            {sources.map((s) => (
              <FilterChip key={s} active={sourceFilter === s} onClick={() => setSourceFilter(s)}>
                {s}
              </FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      {open.length === 0 && (!showCompleted || completed.length === 0) ? (
        <EmptyState icon={CheckSquare} title="No matching tasks" description="Adjust the filters above." />
      ) : null}

      {visibleBuckets.map((b) =>
        grouped[b].length > 0 ? (
          <TaskSection key={b} title={BUCKET_LABEL[b]} count={grouped[b].length}>
            {grouped[b].map((t) => (
              <TaskItem key={t.id} task={t} busy={busy === t.id} onComplete={() => complete(t.id)} />
            ))}
          </TaskSection>
        ) : null,
      )}

      {showCompleted && completed.length > 0 ? (
        <TaskSection title="Completed" count={completed.length}>
          {completed.map((t) => (
            <TaskItem key={t.id} task={t} busy={false} onComplete={() => {}} />
          ))}
        </TaskSection>
      ) : null}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
        (active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}

function TaskSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <MonoLabel as="h2" muted={false} className="flex items-center gap-2 text-foreground">
        {title}
        <Numeric className="text-muted-foreground">{count}</Numeric>
      </MonoLabel>
      <ul className="divide-y rounded-lg border">{children}</ul>
    </section>
  )
}

function TaskItem({ task, busy, onComplete }: { task: TaskRow; busy: boolean; onComplete: () => void }) {
  const href = taskHref(task)
  const due = task.due_at ? new Date(task.due_at) : null
  return (
    <li className="flex items-center gap-3 p-3">
      {task.completed ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-won/15 text-status-won" aria-label="Completed">
          <Check className="h-4 w-4" aria-hidden />
        </span>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onComplete}
          disabled={busy}
          aria-label={`Mark "${task.title}" complete`}
        >
          <Check className="h-4 w-4" aria-hidden />
        </Button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/app/tasks/${task.id}`} className={'truncate font-medium ' + (task.completed ? 'text-muted-foreground line-through' : 'hover:underline')}>
            {task.title}
          </Link>
          {task.source !== 'manual' ? (
            <Badge variant="draft" title={`Auto-generated by ${task.source}`}>
              {task.source}
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {due ? <span>Due <Numeric>{due.toLocaleDateString('en-US')}</Numeric></span> : <span>No due date</span>}
          {href ? (
            <Link href={href} className="text-primary hover:underline">
              View source record
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  )
}
