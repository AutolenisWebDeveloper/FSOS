import { ListShell, ErrorState, EmptyState, WizardShell } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P-2 Data Imports (A6 wizard). Steps: upload → mapping → validate → preview → commit
// → error report → rollback. Preview shows exactly what will change; rollback restores
// pre-import state (no partial-commit corruption; idempotent by dedupe).
export default async function DataImportsPage() {
  const jobs = await load<{ id: string; entity: string; status: string; row_count: number; error_count: number; created_at: string }[]>(
    (db) => db.from('import_jobs').select('id, entity, status, row_count, error_count, created_at').order('created_at', { ascending: false }).limit(100),
    [],
  )

  return (
    <ListShell title="Data Imports" description="CSV import with mapping, validation, preview, commit, and rollback." breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Data Imports' }]}>
      <div className="space-y-6">
        <WizardShell title="New import" steps={['Upload', 'Mapping', 'Validate', 'Preview', 'Commit']} current={0}>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Import agencies, households, policies, referrals, opportunities, commissions, or documents from CSV.</p>
            <p>Every import: field mapping → Zod per-row validation → preview of exact changes (dedupe on email/phone/policy #) → commit → per-row error report → audit + rollback token. No silent partial-commit corruption; re-running the same file is idempotent.</p>
          </div>
        </WizardShell>

        <div>
          <p className="mb-2 text-sm font-medium">Import history</p>
          {!jobs.ok ? (
            <ErrorState description={jobs.kind === 'not_configured' ? 'Database not configured.' : jobs.message} />
          ) : jobs.data.length === 0 ? (
            <EmptyState title="No imports yet" description="Committed imports appear here with their rollback token." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Entity</TableHead><TableHead>Rows</TableHead><TableHead>Errors</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {jobs.data.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="text-muted-foreground">{new Date(j.created_at).toLocaleDateString('en-US')}</TableCell>
                      <TableCell className="capitalize">{j.entity}</TableCell>
                      <TableCell>{j.row_count}</TableCell>
                      <TableCell>{j.error_count}</TableCell>
                      <TableCell><Badge variant={j.status === 'committed' ? 'won' : j.status === 'failed' ? 'lost' : j.status === 'rolledback' ? 'outline' : 'pending'}>{j.status}</Badge></TableCell>
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
