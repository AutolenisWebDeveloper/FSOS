import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-6 Jobs. Background/cron with retries + idempotency + failure. A failed job is
// visible + retryable without duplication (dedupe_key).
export default async function SuperJobsPage() {
  const rows = await load<{ id: string; job: string; status: string; dedupe_key: string; error: string | null; started_at: string }[]>(
    (db) => db.from('job_runs').select('id, job, status, dedupe_key, error, started_at').order('started_at', { ascending: false }).limit(200),
    [],
  )
  const jobNames = ['renewal-watch','conversion-watch','xdate-watch','referral-sla','agency-dormancy','cross-sell-scan','commission-reconcile','campaign-dispatch','data-quality','backup-verify']
  return (
    <ListShell title="Jobs" description="Background/cron jobs. Idempotent by dedupe key; failures are retryable without duplication." breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Jobs' }]}>
      <div className="mb-4 flex flex-wrap gap-2">{jobNames.map((j) => (<Badge key={j} variant="outline">{j}</Badge>))}</div>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No job runs yet" description="Cron job runs appear here once they fire." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((r) => (<TableRow key={r.id}><TableCell className="text-muted-foreground"><Numeric>{new Date(r.started_at).toLocaleString('en-US')}</Numeric></TableCell><TableCell className="font-medium">{r.job}</TableCell><TableCell><Badge variant={r.status === 'completed' ? 'won' : r.status === 'errored' ? 'lost' : 'pending'}>{r.status}</Badge></TableCell><TableCell className="max-w-md truncate text-destructive">{r.error ?? '—'}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
