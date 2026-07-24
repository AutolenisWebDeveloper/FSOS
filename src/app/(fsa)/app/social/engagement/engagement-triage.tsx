'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserSearch, ListTodo, TrendingUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ContactHit {
  id: string
  full_name: string
  email: string | null
}

export function EngagementTriage({
  id,
  resolved,
  hasTask,
  hasOpportunity,
}: {
  id: string
  resolved: boolean
  hasTask: boolean
  hasOpportunity: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<null | 'link' | 'task'>(null)
  const [error, setError] = useState<string | null>(null)

  // link state
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ContactHit[]>([])
  const [searching, setSearching] = useState(false)
  // task state
  const [taskTitle, setTaskTitle] = useState('')

  async function search(term: string) {
    setQ(term)
    if (term.trim().length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    const resp = await fetch(`/api/app/contacts?q=${encodeURIComponent(term)}`)
    const body = await resp.json().catch(() => ({ contacts: [] }))
    setHits(Array.isArray(body.contacts) ? body.contacts : [])
    setSearching(false)
  }

  function linkTo(contactId: string) {
    setError(null)
    startTransition(async () => {
      const resp = await fetch(`/api/social/engagement/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      })
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}))
        setError(b.error || 'Could not link contact.')
        return
      }
      setMode(null)
      router.refresh()
    })
  }

  function createTask() {
    setError(null)
    if (!taskTitle.trim()) {
      setError('Enter a task title.')
      return
    }
    startTransition(async () => {
      const resp = await fetch(`/api/social/engagement/${id}/task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: taskTitle }),
      })
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}))
        setError(b.error || 'Could not create task.')
        return
      }
      setMode(null)
      setTaskTitle('')
      router.refresh()
    })
  }

  function createOpportunity() {
    setError(null)
    startTransition(async () => {
      const resp = await fetch(`/api/social/engagement/${id}/opportunity`, { method: 'POST' })
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}))
        setError(b.error || 'Could not create opportunity.')
        return
      }
      router.refresh()
    })
  }

  function dismiss() {
    startTransition(async () => {
      const resp = await fetch(`/api/social/engagement/${id}`, { method: 'DELETE' })
      if (resp.ok) router.refresh()
    })
  }

  return (
    <div className="mt-3 border-t border-shell-border pt-3">
      {mode === 'link' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input value={q} onChange={(e) => search(e.target.value)} placeholder="Search existing contacts…" className="h-8" autoFocus />
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {searching ? <p className="text-xs text-muted-foreground">Searching…</p> : null}
          {hits.length > 0 ? (
            <ul className="rounded-md border border-shell-border">
              {hits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => linkTo(c.id)}
                    disabled={pending}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40"
                  >
                    <span>{c.full_name}</span>
                    <span className="text-xs text-muted-foreground">{c.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.trim().length >= 2 && !searching ? (
            <p className="text-xs text-muted-foreground">No existing contact matches — a new contact is never created here.</p>
          ) : null}
        </div>
      ) : mode === 'task' ? (
        <div className="flex items-center gap-2">
          <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Follow-up task title" className="h-8" autoFocus />
          <Button size="sm" onClick={createTask} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!resolved ? (
            <Button size="sm" variant="ghost" onClick={() => setMode('link')}>
              <UserSearch className="mr-1 h-4 w-4" aria-hidden />
              Link contact
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setMode('task')} disabled={hasTask}>
            <ListTodo className="mr-1 h-4 w-4" aria-hidden />
            {hasTask ? 'Task created' : 'Create task'}
          </Button>
          <Button size="sm" variant="ghost" onClick={createOpportunity} disabled={!resolved || hasOpportunity || pending}>
            <TrendingUp className="mr-1 h-4 w-4" aria-hidden />
            {hasOpportunity ? 'Opportunity created' : 'Create opportunity'}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} disabled={pending}>
            Dismiss
          </Button>
        </div>
      )}
      {error ? (
        <p className="mt-2 text-xs text-status-lost" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
