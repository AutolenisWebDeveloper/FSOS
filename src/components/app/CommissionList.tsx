'use client'

import * as React from 'react'
import Link from 'next/link'
import { DollarSign } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Money } from '@/components/ui/typography'
import { ListPagination } from '@/components/ui/pagination'
import { paginate } from '@/lib/data/paginate'
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
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const filtered = React.useMemo(() => {
    let r = rows
    if (family) r = r.filter((x) => x.product_family === family)
    if (secOnly) r = r.filter((x) => x.is_security)
    return r
  }, [rows, family, secOnly])

  React.useEffect(() => setPage(0), [family, secOnly])

  const paged = paginate(filtered, page, pageSize)

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
            {paged.items.map((c) => (
              <TableRow key={c.id} className={c.is_security ? securitiesRowClass : undefined}>
                <TableCell><Link href={`/app/commissions/${c.id}`} className="font-medium text-primary hover:underline">{c.agency_name ?? 'Direct'}</Link>{c.is_security ? <SecuritiesChip className="ml-2" /> : null}{c.is_trail ? <Badge variant="outline" className="ml-2">trail</Badge> : null}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{c.product_family ?? '—'}</TableCell>
                <TableCell className="text-right"><Money value={Number(c.total_commission)} /></TableCell>
                <TableCell className="text-right"><Money value={Number(c.fsa_amount)} /></TableCell>
                <TableCell className="text-right"><Money value={Number(c.agency_amount)} /></TableCell>
                <TableCell><Badge variant={c.reconciliation_status === 'matched' ? 'won' : c.reconciliation_status === 'discrepancy' ? 'lost' : 'pending'}>{c.reconciliation_status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ListPagination
        page={paged.page}
        pageSize={pageSize}
        total={filtered.length}
        noun="commission"
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0) }}
      />
    </div>
  )
}
