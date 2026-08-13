'use client'

import * as React from 'react'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Numeric } from '@/components/ui/typography'
import { ListPagination } from '@/components/ui/pagination'
import { paginate } from '@/lib/data/paginate'
import { EmptyState } from '@/components/archetypes'

export interface DocumentRow {
  id: string
  file_name: string | null
  classification: string | null
  entity_type: string | null
  scan_status: string
  retention_until: string | null
  legal_hold: boolean
}

/**
 * Document Library list (A2) with the shared search / filter / pagination idiom.
 * The page owns the (already capped) query; this component paginates and filters
 * the loaded set client-side — no change to storage, scanning, or data access.
 */
export function DocumentList({ rows }: { rows: DocumentRow[] }) {
  const [q, setQ] = React.useState('')
  const [scan, setScan] = React.useState('')
  const [holdOnly, setHoldOnly] = React.useState(false)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  const scanStatuses = React.useMemo(() => Array.from(new Set(rows.map((d) => d.scan_status))).sort(), [rows])

  const filtered = React.useMemo(() => {
    let r = rows
    const n = q.trim().toLowerCase()
    if (n) r = r.filter((d) => (d.file_name ?? '').toLowerCase().includes(n) || (d.classification ?? '').toLowerCase().includes(n))
    if (scan) r = r.filter((d) => d.scan_status === scan)
    if (holdOnly) r = r.filter((d) => d.legal_hold)
    return r
  }, [rows, q, scan, holdOnly])

  React.useEffect(() => setPage(0), [q, scan, holdOnly])

  const paged = paginate(filtered, page, pageSize)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search file or classification…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" aria-label="Search documents" />
        <Select value={scan} onChange={(e) => setScan(e.target.value)} className="max-w-[11rem]" aria-label="Filter scan status">
          <option value="">All scan states</option>
          {scanStatuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={holdOnly} onChange={(e) => setHoldOnly(e.target.checked)} /> Legal hold only
        </label>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="No matches" description="Adjust your search or filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Scan</TableHead>
                <TableHead>Retention</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/app/documents/${d.id}`} className="font-medium text-primary hover:underline">{d.file_name ?? 'Document'}</Link>
                    {d.legal_hold ? <Badge variant="blocked" className="ml-2">legal hold</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.classification ?? d.entity_type ?? '—'}</TableCell>
                  <TableCell><Badge variant={d.scan_status === 'clean' ? 'won' : d.scan_status === 'infected' ? 'lost' : 'pending'}>{d.scan_status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{d.retention_until ?? '—'}</Numeric></TableCell>
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
        noun="document"
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(0) }}
      />
    </div>
  )
}
