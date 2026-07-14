'use client'

import * as React from 'react'
import Link from 'next/link'
import { Users, Download } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/archetypes'

export interface HouseholdRow {
  id: string
  primary_name: string
  agency_name: string | null
  members: number
  policies: number
  opportunities: number
  do_not_contact: boolean
  archived_at: string | null
}

export function HouseholdList({ rows }: { rows: HouseholdRow[] }) {
  const [q, setQ] = React.useState('')
  const [dncOnly, setDncOnly] = React.useState(false)

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((h) => h.primary_name.toLowerCase().includes(n) || (h.agency_name ?? '').toLowerCase().includes(n))
    if (dncOnly) r = r.filter((h) => h.do_not_contact)
    return r
  }, [rows, q, dncOnly])

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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
