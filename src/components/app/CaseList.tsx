'use client'

import * as React from 'react'
import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { ListPagination } from '@/components/ui/pagination'
import { paginate } from '@/lib/data/paginate'
import { EmptyState } from '@/components/archetypes'

export interface CaseRow {
  id: string
  household_name: string
  status: string
  is_security: boolean
  submitted_at: string | null
}

/**
 * Case Directory list (A2, NIGO-free) with the shared search / filter / pagination
 * idiom. The page resolves household names server-side and passes the rows; this
 * component handles the client-side view state only — no new data source.
 */
export function CaseList({ rows }: { rows: CaseRow[] }) {
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [secOnly, setSecOnly] = React.useState(false)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  const statuses = React.useMemo(() => Array.from(new Set(rows.map((c) => c.status))).sort(), [rows])

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((c) => c.household_name.toLowerCase().includes(n))
    if (status) r = r.filter((c) => c.status === status)
    if (secOnly) r = r.filter((c) => c.is_security)
    return r
  }, [rows, q, status, secOnly])

  React.useEffect(() => setPage(0), [q, status, secOnly])

  const paged = paginate(filtered, page, pageSize)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search household…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search cases" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[13rem]" aria-label="Filter status">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={secOnly} onChange={(e) => setSecOnly(e.target.checked)} /> Securities only
        </label>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={Briefcase} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Household</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.items.map((c) => (
                <TableRow key={c.id} className={c.is_security ? securitiesRowClass : undefined}>
                  <TableCell>
                    <Link href={`/app/cases/${c.id}`} className="font-medium text-primary hover:underline">{c.household_name}</Link>
                    {c.is_security ? <SecuritiesChip className="ml-2" /> : null}
                  </TableCell>
                  <TableCell><Badge variant={c.status === 'issued' || c.status === 'in_service' ? 'won' : c.status === 'declined' || c.status === 'withdrawn' ? 'lost' : 'active'}>{c.status.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-US') : '—'}</Numeric></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ListPagination
        page={paged.page}
        pageSize={pageSize}
        total={filtered.length}
        noun="case"
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0) }}
      />
    </div>
  )
}
