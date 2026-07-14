import { DatabaseBackup } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface BackupRow {
  id: string
  job: string
  status: string
  started_at: string | null
  finished_at: string | null
  error: string | null
}

function statusVariant(status: string): 'won' | 'lost' | 'active' | 'pending' {
  if (status === 'completed') return 'won'
  if (status === 'errored') return 'lost'
  if (status === 'running') return 'active'
  return 'pending'
}

// Super · Backups (A2). Backup job runs from job_runs, newest first.
export default async function SuperBackupsPage() {
  const runs = await load<BackupRow[]>(
    (db) => db.from('job_runs').select('id, job, status, started_at, finished_at, error').ilike('job', '%backup%').order('started_at', { ascending: false }),
    [],
  )

  const note = (
    <div className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-xs text-status-assumption">
      Independent pg_dump export is the ownership/portability fallback (labeled placeholder — no external backup API is assumed).
    </div>
  )

  let body: React.ReactNode
  if (!runs.ok) {
    body =
      runs.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load backup runs." />
      ) : (
        <ErrorState description={runs.message} />
      )
  } else if (runs.data.length === 0) {
    body = (
      <div className="space-y-4">
        <EmptyState icon={DatabaseBackup} title="No backup runs recorded yet" description="Backup job runs appear here once recorded." />
        {note}
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.job}</TableCell>
                  <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.started_at ? new Date(r.started_at).toLocaleString('en-US') : '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.finished_at ? new Date(r.finished_at).toLocaleString('en-US') : '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{r.error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {note}
      </div>
    )
  }

  return (
    <ListShell
      title="Backups"
      description="Backup job runs and the ownership/portability fallback."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Backups' }]}
    >
      {body}
    </ListShell>
  )
}
