'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Users, FileText, Target } from 'lucide-react'
import { DrawerShell } from '@/components/archetypes/overlays'
import { ContactStatusRow } from './status-row'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getJson } from '@/lib/client/api'
import { timeAgo, humanize } from '@/lib/dashboards/format'

/*
 * Contact Peek (redesign spec §4.4) — the reusable drawer invoked from the list
 * and every work-item so a person is peeked, never re-rendered bespoke ("peek,
 * don't duplicate", §3 / §12). One component, RLS + firewall enforced server-side
 * via /api/households/[id]/peek. It shows identity, the shared Status Row chips,
 * next action, the last 3 Timeline entries, and "Open full record".
 */

interface PeekData {
  id: string
  name: string
  location: string | null
  agencyName: string | null
  doNotContact: boolean
  archived: boolean
  hasSecurities: boolean
  counts: { members: number; policies: number; openOpportunities: number }
  nextAction: string
  recent: { id: string; kind: string | null; note: string | null; created_at: string }[]
}

// ─── Context: mount one drawer per subtree; any descendant opens it by id ───────

interface PeekContextValue {
  openPeek: (householdId: string) => void
}
const PeekContext = React.createContext<PeekContextValue | null>(null)

/** Reuse the peek anywhere: wrap a subtree and call useContactPeek().openPeek(id). */
export function ContactPeekProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = React.useState<string | null>(null)
  const openPeek = React.useCallback((householdId: string) => setId(householdId), [])
  return (
    <PeekContext.Provider value={{ openPeek }}>
      {children}
      <ContactPeek householdId={id} onOpenChange={(v) => !v && setId(null)} />
    </PeekContext.Provider>
  )
}

export function useContactPeek(): PeekContextValue {
  const ctx = React.useContext(PeekContext)
  if (!ctx) throw new Error('useContactPeek must be used within a ContactPeekProvider')
  return ctx
}

// ─── The drawer ────────────────────────────────────────────────────────────────

export function ContactPeek({
  householdId,
  onOpenChange,
}: {
  householdId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = React.useState<PeekData | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!householdId) return
    let active = true
    setLoading(true)
    setError(null)
    setData(null)
    getJson<PeekData>(`/api/households/${householdId}/peek`).then((res) => {
      if (!active) return
      setLoading(false)
      if (res.ok) setData(res.data)
      else setError(res.error.error || 'Could not load this contact.')
    })
    return () => {
      active = false
    }
  }, [householdId])

  return (
    <DrawerShell
      open={!!householdId}
      onOpenChange={onOpenChange}
      title={data?.name ?? (loading ? 'Loading…' : 'Contact')}
      description={data?.location ?? undefined}
    >
      {loading ? (
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">Loading contact…</span>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          {householdId ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/app/households/${householdId}`}>Open full record</Link>
            </Button>
          ) : null}
        </div>
      ) : data ? (
        <div className="space-y-5">
          <ContactStatusRow doNotContact={data.doNotContact} hasSecurities={data.hasSecurities} archived={data.archived} />

          {data.agencyName ? (
            <p className="text-sm text-muted-foreground">
              Referred by <span className="text-foreground">{data.agencyName}</span>
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <PeekStat icon={Users} label="Members" value={data.counts.members} />
            <PeekStat icon={FileText} label="Policies" value={data.counts.policies} />
            <PeekStat icon={Target} label="Open opps" value={data.counts.openOpportunities} />
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next action</p>
            <p className="mt-1 text-sm">{data.nextAction}</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent activity</p>
            {data.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{humanize(r.kind) || 'Activity'}</span>
                      {r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}
                    </span>
                    <time dateTime={r.created_at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {timeAgo(r.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button asChild className="w-full">
            <Link href={`/app/households/${data.id}`}>
              Open full record <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </DrawerShell>
  )
}

function PeekStat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
