'use client'

import * as React from 'react'
import Link from 'next/link'
import { DollarSign } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { EmptyState, AssumptionBadge } from '@/components/archetypes'
import { PRODUCT_FAMILY } from '@/lib/validation/schemas'

export interface CommissionRow {
  id: string
  agency_name: string | null
  product_family: string | null
  is_security: boolean
  total_commission: number
  fsa_amount: number
  agency_amount: number
  received_amount: number
  is_trail: boolean
  paid_on: string | null
  reconciliation_status: string
  is_assumption?: boolean
}

export function CommissionList({ rows, emptyLabel }: { rows: CommissionRow[]; emptyLabel: string }) {
  const [family, setFamily] = React.useState('')
  const [secOnly, setSecOnly] = React.useState(false)
  const filtered = React.useMemo(() => {
    let r = rows
    if (family) r = r.filter((x) => x.product_family === family)
    if (secOnly) r = r.filter((x) => x.is_security)
    return r
  }, [rows, family, secOnly])

  if (rows.length === 0) return <EmptyState icon={DollarSign} title={emptyLabel} description="Commissions are created when an opportunity is placed/issued." />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={family} onChange={(e) => setFamily(e.target.value)} className="max-w-[12rem]" aria-label="Filter family">
          <option value="">All families</option>
          {PRODUCT_FAMILY.map((f) => (<option key={f} value={f}>{f}</option>))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={secOnly} onChange={(e) => setSecOnly(e.target.checked)} /> Securities only</label>
        <AssumptionBadge label="splits — config default, verify" />
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Agency</TableHead><TableHead>Family</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">FSA</TableHead><TableHead className="text-right">Agency</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell><Link href={`/app/commissions/${c.id}`} className="font-medium text-primary hover:underline">{c.agency_name ?? 'Direct'}</Link>{c.is_security ? <Badge variant="blocked" className="ml-2">securities</Badge> : null}{c.is_trail ? <Badge variant="outline" className="ml-2">trail</Badge> : null}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{c.product_family ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">${Number(c.total_commission).toLocaleString('en-US')}</TableCell>
                <TableCell className="text-right tabular-nums">${Number(c.fsa_amount).toLocaleString('en-US')}</TableCell>
                <TableCell className="text-right tabular-nums">${Number(c.agency_amount).toLocaleString('en-US')}</TableCell>
                <TableCell><Badge variant={c.reconciliation_status === 'matched' ? 'won' : c.reconciliation_status === 'discrepancy' ? 'lost' : 'pending'}>{c.reconciliation_status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
