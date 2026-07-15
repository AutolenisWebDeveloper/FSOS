import { ListShell, ErrorState, EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { ExportRequestForm } from '@/components/app/ExportControls'

export const dynamic = 'force-dynamic'

type ExportRow = {
  id: string
  dataset: string
  format: string
  status: string
  row_count: number | null
  requested_at: string
  expires_at: string | null
}

// Map export lifecycle status → shared StatusBadge key.
function statusKey(status: string): StatusKey {
  switch (status) {
    case 'ready': return 'won'
    case 'requested':
    case 'processing': return 'pending'
    case 'failed': return 'lost'
    case 'expired': return 'draft'
    default: return 'draft'
  }
}

function fmtDate(v: string | null): string {
  return v ? new Date(v).toLocaleDateString('en-US') : '—'
}

// P-2 Admin Data Exports (A2 ListShell). Data ownership / portability surface.
export default async function DataExportsPage() {
  const exports = await load<ExportRow[]>(
    (db) => db
      .from('data_exports')
      .select('id, dataset, format, status, row_count, requested_at, expires_at')
      .order('requested_at', { ascending: false })
      .limit(200),
    [],
  )

  return (
    <ListShell
      title="Data Exports"
      description="Request and track full-dataset exports for data ownership and portability."
      breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Data' }, { label: 'Exports' }]}
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Exports exist so the FSA owns and can port their own data. PII stays governed by Row-Level Security and
          retention rules; securities substantive data is never exported (firewall). File generation runs as a
          background job — a request appears here as “requested”, then “ready” once the file is built.
        </p>

        <Card>
          <CardHeader><CardTitle>Request an export</CardTitle></CardHeader>
          <CardContent><ExportRequestForm /></CardContent>
        </Card>

        <div>
          <p className="mb-2 text-sm font-medium">Export history</p>
          {!exports.ok ? (
            <ErrorState description={exports.kind === 'not_configured' ? 'Database not configured.' : exports.message} />
          ) : exports.data.length === 0 ? (
            <EmptyState title="No exports yet" description="Requested exports appear here with their status and expiry." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exports.data.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="capitalize">{e.dataset}</TableCell>
                      <TableCell className="uppercase text-muted-foreground">{e.format}</TableCell>
                      <TableCell><StatusBadge status={statusKey(e.status)} label={e.status} /></TableCell>
                      <TableCell>{e.row_count ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(e.requested_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtDate(e.expires_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </ListShell>
  )
}
