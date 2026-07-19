import { requireRole } from '@/lib/auth/session'
import { ListShell, ErrorState, EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { GhlImportWizard } from '@/components/admin/GhlImportWizard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUS_MAP: Record<string, StatusKey> = {
  preview: 'draft',
  committed: 'won',
  rolledback: 'draft',
  failed: 'lost',
}

// GHL Contact Upload (docs/legacy-port.md §2.6) — A6 wizard. GHL contacts →
// households + members (+ consent), dedupe, preview + rollback. No-consent contacts
// are flagged and unsendable; no securities data is imported.
export default async function GhlImportPage() {
  await requireRole('admin', '/admin/data/imports/ghl')

  const jobs = await load<
    { id: string; status: string; row_count: number; error_count: number; created_at: string }[]
  >(
    (db) =>
      db
        .from('import_jobs')
        .select('id, status, row_count, error_count, created_at')
        .eq('entity', 'ghl_contacts')
        .order('created_at', { ascending: false })
        .limit(50),
    [],
  )

  return (
    <ListShell
      title="Import GHL Contacts"
      description="Bring GoHighLevel contacts into the book as households with captured consent. Preview and roll back safely."
      breadcrumb={[
        { label: 'Admin', href: '/admin' },
        { label: 'Data Imports', href: '/admin/data/imports' },
        { label: 'GHL Contacts' },
      ]}
    >
      <div className="space-y-6">
        <GhlImportWizard />

        <div>
          <p className="mb-2 text-sm font-medium">Import history</p>
          {!jobs.ok ? (
            <ErrorState description={jobs.kind === 'not_configured' ? 'Database not configured.' : jobs.message} />
          ) : jobs.data.length === 0 ? (
            <EmptyState title="No GHL imports yet" description="Committed imports appear here with their rollback token." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Errors</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="numeric text-muted-foreground">
                        {new Date(j.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="numeric">{j.row_count}</TableCell>
                      <TableCell className="numeric">{j.error_count}</TableCell>
                      <TableCell>
                        <StatusBadge status={STATUS_MAP[j.status] ?? 'draft'} label={j.status} />
                      </TableCell>
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
