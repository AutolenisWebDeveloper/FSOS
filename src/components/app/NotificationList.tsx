'use client'

import * as React from 'react'
import Link from 'next/link'
import { Bell, Check, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MonoLabel } from '@/components/ui/typography'
import { EmptyState, ErrorState } from '@/components/archetypes'
import { patchJson } from '@/lib/client/api'

type Notification = {
  id: string
  kind: string | null
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

function fmt(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Notification inbox (ports the legacy top-bar bell). Loads the user's real
// notifications and marks them read via /api/app/notifications.
export function NotificationList({
  initial,
  initialError,
}: {
  initial: Notification[]
  initialError?: string
}) {
  const [items, setItems] = React.useState<Notification[]>(initial)
  const [busy, setBusy] = React.useState(false)
  const unread = items.filter((n) => !n.read_at).length

  async function markOne(id: string) {
    setBusy(true)
    const res = await patchJson('/api/app/notifications', { id })
    setBusy(false)
    if (res.ok) {
      const now = new Date().toISOString()
      setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read_at: now } : n)))
    }
  }

  async function markAll() {
    setBusy(true)
    const res = await patchJson('/api/app/notifications', { all: true })
    setBusy(false)
    if (res.ok) {
      const now = new Date().toISOString()
      setItems((xs) => xs.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    }
  }

  if (initialError) return <ErrorState description={initialError} />
  if (items.length === 0) {
    return <EmptyState icon={Bell} title="You're all caught up" description="New notifications from FSOS will appear here." />
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MonoLabel>{unread > 0 ? `${unread} unread` : 'All read'}</MonoLabel>
        <Button variant="outline" size="sm" onClick={() => void markAll()} disabled={busy || unread === 0}>
          <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
        </Button>
      </div>
      <ul className="divide-y rounded-lg border">
        {items.map((n) => {
          const row = (
            <div className={n.read_at ? 'flex items-start gap-3 px-4 py-3' : 'flex items-start gap-3 bg-accent/5 px-4 py-3'}>
              <span
                className={n.read_at ? 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent' : 'mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent'}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {n.kind ? <MonoLabel>{n.kind}</MonoLabel> : null}
                  <span className="text-xs text-muted-foreground">{fmt(n.created_at)}</span>
                </div>
                <p className="mt-0.5 text-sm font-medium">{n.title}</p>
                {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
              </div>
              {!n.read_at ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault()
                    void markOne(n.id)
                  }}
                  disabled={busy}
                  aria-label="Mark read"
                >
                  <Check className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          )
          return (
            <li key={n.id}>
              {n.link ? (
                <Link href={n.link} className="block hover:bg-muted focus:bg-muted focus:outline-none" onClick={() => void markOne(n.id)}>
                  {row}
                </Link>
              ) : (
                row
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
