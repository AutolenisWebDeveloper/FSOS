'use client'

import * as React from 'react'
import Link from 'next/link'
import { Building2, Download } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/archetypes'
import { AGENCY_STATUS } from '@/lib/validation/schemas'

export interface AgencyRow {
  id: string
  agency_name: string
  owner_name: string
  status: string
  ytd_placed_premium: number
  ytd_referrals: number
  last_contact_at: string | null
  archived_at: string | null
  overdue_checkin: boolean
}

const PAGE = 25

function fmtMoney(n: number) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
function fmtDate(s: string | null) {
  return s ? new Date(s).toLocaleDateString('en-US') : '—'
}

export function AgencyList({ rows }: { rows: AgencyRow[] }) {
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [overdue, setOverdue] = React.useState(false)
  const [sort, setSort] = React.useState<'premium' | 'contact' | 'name'>('premium')
  const [page, setPage] = React.useState(0)

  const filtered = React.useMemo(() => {
    let r = rows
    const needle = q.trim().toLowerCase()
    if (needle) r = r.filter((a) => a.agency_name.toLowerCase().includes(needle) || a.owner_name.toLowerCase().includes(needle))
    if (status) r = r.filter((a) => a.status === status)
    if (overdue) r = r.filter((a) => a.overdue_checkin)
    r = [...r].sort((a, b) => {
      if (sort === 'name') return a.agency_name.localeCompare(b.agency_name)
      if (sort === 'contact') return (b.last_contact_at ?? '').localeCompare(a.last_contact_at ?? '')
      return (b.ytd_placed_premium ?? 0) - (a.ytd_placed_premium ?? 0)
    })
    return r
  }, [rows, q, status, overdue, sort])

  React.useEffect(() => setPage(0), [q, status, overdue, sort])

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))

  function exportCsv() {
    const header = ['Agency', 'Owner', 'Status', 'YTD Premium', 'YTD Referrals', 'Last Contact']
    const lines = filtered.map((a) =>
      [a.agency_name, a.owner_name, a.status, a.ytd_placed_premium, a.ytd_referrals, fmtDate(a.last_contact_at)]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'agencies.csv'
    a.click()
    URL.revokeObjectURL(url)
    // Export is audited server-side via a lightweight beacon.
    fetch('/api/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'entity.viewed', entity: 'agency_partnership', diff: { export: 'csv', count: filtered.length } }),
    }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search agency or owner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
          aria-label="Search agencies"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" aria-label="Filter status">
          <option value="">All statuses</option>
          {AGENCY_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="max-w-[12rem]" aria-label="Sort">
          <option value="premium">Sort: YTD premium</option>
          <option value="contact">Sort: last contact</option>
          <option value="name">Sort: name</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          Overdue check-in
        </label>
        <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No agency partnerships yet"
          description="Your book of agency-owner partnerships is the aggregate root of FSOS — start here."
          action={
            <Button asChild>
              <Link href="/app/agencies/new">Add your first agency partnership</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden sm:block rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agency</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">YTD Premium</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                  <TableHead>Last Contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/app/agencies/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.agency_name}
                      </Link>
                      {a.overdue_checkin ? (
                        <Badge variant="pending" className="ml-2">
                          overdue check-in
                        </Badge>
                      ) : null}
                      {a.archived_at ? <Badge variant="draft" className="ml-2">archived</Badge> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.owner_name}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'producing' ? 'won' : a.status === 'terminated' ? 'lost' : 'active'}>
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(a.ytd_placed_premium)}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.ytd_referrals}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(a.last_contact_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {pageRows.map((a) => (
              <Link
                key={a.id}
                href={`/app/agencies/${a.id}`}
                className="block rounded-lg border p-3 hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{a.agency_name}</span>
                  <Badge variant={a.status === 'producing' ? 'won' : 'active'}>{a.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{a.owner_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtMoney(a.ytd_placed_premium)} · {a.ytd_referrals} referrals
                  {a.overdue_checkin ? ' · overdue check-in' : ''}
                </p>
              </Link>
            ))}
          </div>

          {pages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {filtered.length} agencies · page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
