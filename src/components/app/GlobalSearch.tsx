'use client'

import * as React from 'react'
import Link from 'next/link'
import { Search, Building2, Users, UserPlus, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { MonoLabel } from '@/components/ui/typography'
import { EmptyState } from '@/components/archetypes'

type Hit = {
  type: 'household' | 'member' | 'agency' | 'referral'
  id: string
  title: string
  subtitle: string | null
  href: string
}

const ICON: Record<Hit['type'], LucideIcon> = {
  household: Users,
  member: Users,
  agency: Building2,
  referral: UserPlus,
}

const TYPE_LABEL: Record<Hit['type'], string> = {
  household: 'Household',
  member: 'Member',
  agency: 'Agency',
  referral: 'Referral',
}

// Client global-search console. Debounced RLS-scoped fetch against
// /api/app/search. Renders states per design-system.md §6 (loading spinner,
// empty state, error). Whole-row links to the record (no dead ends).
export function GlobalSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const [q, setQ] = React.useState(initialQuery)
  const [hits, setHits] = React.useState<Hit[]>([])
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const term = q.trim()
    if (term.length < 2) {
      setHits([])
      setState('idle')
      return
    }
    setState('loading')
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/app/search?q=${encodeURIComponent(term)}&limit=8`, { signal: ctrl.signal })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(json.error || `Search failed (${res.status})`)
          setState('error')
          return
        }
        setHits(Array.isArray(json.results) ? json.results : [])
        setState('ready')
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError('Network error')
        setState('error')
      }
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  return (
    <div className="space-y-4">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <Input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search households, members, agencies, referrals…"
          aria-label="Global search"
          className="pl-9"
        />
        {state === 'loading' ? (
          <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </label>

      {state === 'idle' && q.trim().length < 2 ? (
        <p className="text-sm text-muted-foreground">Type at least two characters to search your book.</p>
      ) : null}

      {state === 'error' ? (
        <div role="alert" className="rounded-lg border border-l-2 border-status-lost/30 border-l-status-lost bg-status-lost/5 p-4 text-sm">
          {error}
        </div>
      ) : null}

      {state === 'ready' && hits.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing found for “${q.trim()}”.`} />
      ) : null}

      {hits.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {hits.map((h) => {
            const Icon = ICON[h.type]
            return (
              <li key={`${h.type}:${h.id}`}>
                <Link href={h.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted focus:bg-muted focus:outline-none">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    {h.subtitle ? <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span> : null}
                  </span>
                  <MonoLabel>{TYPE_LABEL[h.type]}</MonoLabel>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
