'use client'

import * as React from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/archetypes'
import { POLICY_STATUS } from '@/lib/validation/schemas'

export interface PolicyRow {
  id: string
  policy_number: string | null
  household_name: string | null
  status: string
  is_with_us: boolean
  is_security: boolean
  renewal_date: string | null
  x_date: string | null
  conversion_deadline: string | null
}

export function PolicyList({ rows }: { rows: PolicyRow[] }) {
  const [q, setQ] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [book, setBook] = React.useState('')

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((p) => (p.policy_number ?? '').toLowerCase().includes(n) || (p.household_name ?? '').toLowerCase().includes(n))
    if (status) r = r.filter((p) => p.status === status)
    if (book) r = r.filter((p) => (book === 'own' ? p.is_with_us : !p.is_with_us))
    return r
  }, [rows, q, status, book])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No policies yet"
        description="Record own-book policies and competitor X-date policies to drive renewals and conversions."
        action={<Button asChild><Link href="/app/policies/new">Record a policy</Link></Button>}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search policy # or household…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search policies" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-[10rem]" aria-label="Filter status">
          <option value="">All statuses</option>
          {POLICY_STATUS.map((s) => (<option key={s} value={s}>{s}</option>))}
        </Select>
        <Select value={book} onChange={(e) => setBook(e.target.value)} className="max-w-[12rem]" aria-label="Filter book">
          <option value="">Own &amp; competitor</option>
          <option value="own">Own book</option>
          <option value="competitor">Competitor (X-date)</option>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy #</TableHead>
                <TableHead>Household</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Book</TableHead>
                <TableHead>Key date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/app/policies/${p.id}`} className="font-medium text-primary hover:underline">{p.policy_number ?? 'Unnumbered'}</Link>
                    {p.is_security ? <Badge variant="blocked" className="ml-2">securities</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.household_name ?? '—'}</TableCell>
                  <TableCell><Badge variant={p.status === 'active' ? 'won' : p.status === 'lapsed' || p.status === 'cancelled' ? 'lost' : 'active'}>{p.status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{p.is_with_us ? 'Own book' : 'Competitor'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.is_with_us
                      ? p.conversion_deadline
                        ? `Convert by ${new Date(p.conversion_deadline).toLocaleDateString('en-US')}`
                        : p.renewal_date
                          ? `Renews ${new Date(p.renewal_date).toLocaleDateString('en-US')}`
                          : '—'
                      : p.x_date
                        ? `X-date ${new Date(p.x_date).toLocaleDateString('en-US')}`
                        : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
