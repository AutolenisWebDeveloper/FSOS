'use client'

import * as React from 'react'
import Link from 'next/link'
import { Users, Download, PanelRightOpen } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/archetypes'
import { ContactPeek } from '@/components/archetypes/contact/peek'
import { CONTACT_VIEWS, type ContactViewKey } from '@/lib/contacts/views'

export interface HouseholdRow {
  id: string
  primary_name: string
  agency_name: string | null
  members: number
  policies: number
  opportunities: number
  do_not_contact: boolean
  archived_at: string | null
  /** Saved views this household belongs to (§4.1); always includes 'all'. */
  views: string[]
}

export function HouseholdList({ rows, viewCounts }: { rows: HouseholdRow[]; viewCounts?: Record<string, number> }) {
  const [q, setQ] = React.useState('')
  const [dncOnly, setDncOnly] = React.useState(false)
  const [view, setView] = React.useState<ContactViewKey>('all')
  const [peekId, setPeekId] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    let r = rows
    if (view !== 'all') r = r.filter((h) => h.views.includes(view))
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((h) => h.primary_name.toLowerCase().includes(n) || (h.agency_name ?? '').toLowerCase().includes(n))
    if (dncOnly) r = r.filter((h) => h.do_not_contact)
    return r
  }, [rows, q, dncOnly, view])

  function exportCsv() {
    const header = ['Household', 'Referring agency', 'Members', 'Policies', 'Opportunities', 'DNC']
    const lines = filtered.map((h) => [h.primary_name, h.agency_name ?? '', h.members, h.policies, h.opportunities, h.do_not_contact ? 'yes' : 'no'].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'households.csv'
    a.click()
    URL.revokeObjectURL(url)
    fetch('/api/audit/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'entity.viewed', entity: 'household', diff: { export: 'csv', count: filtered.length } }) }).catch(() => {})
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No households yet"
        description="Households enter your book from a converted referral, or add one directly."
        action={
          <div className="flex gap-2">
            <Button asChild><Link href="/app/households/new">Add household</Link></Button>
            <Button asChild variant="outline"><Link href="/app/referrals">Convert a referral</Link></Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
      {/* Saved-view rail (§4.1) — the per-workflow lists as filters over one book. */}
      <nav aria-label="Saved views" className="flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
        {CONTACT_VIEWS.map((v) => {
          const active = v.key === view
          const n = viewCounts?.[v.key]
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors lg:w-full',
                active ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span>{v.label}</span>
              {typeof n === 'number' ? <span className="tabular-nums text-xs text-muted-foreground">{n}</span> : null}
            </button>
          )
        })}
      </nav>

      <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search household or agency…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search households" />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={dncOnly} onChange={(e) => setDncOnly(e.target.checked)} /> DNC only
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto"><Download className="h-4 w-4" /> Export</Button>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Referring agency</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Policies</TableHead>
                <TableHead className="text-right">Opportunities</TableHead>
                <TableHead className="w-10 text-right"><span className="sr-only">Peek</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>
                    <Link href={`/app/households/${h.id}`} className="font-medium text-primary hover:underline">{h.primary_name}</Link>
                    {h.do_not_contact ? <Badge variant="blocked" className="ml-2">DNC</Badge> : null}
                    {h.archived_at ? <Badge variant="draft" className="ml-2">archived</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{h.agency_name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.members}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.policies}</TableCell>
                  <TableCell className="text-right tabular-nums">{h.opportunities}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPeekId(h.id)}
                      aria-label={`Peek at ${h.primary_name}`}
                      title="Quick look"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ContactPeek householdId={peekId} onOpenChange={(v) => !v && setPeekId(null)} />
      </div>
    </div>
  )
}
