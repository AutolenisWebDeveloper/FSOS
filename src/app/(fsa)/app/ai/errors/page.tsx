import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-15 Errors (A2). Errored runs → retryable; provider fallback happens in the gateway.
export default async function AiErrorsPage() {
  const runs = await load<{ id: string; agent_key: string; error: string | null; started_at: string }[]>(
    (db) => db.from('agent_runs').select('id, agent_key, error, started_at').eq('status', 'errored').order('started_at', { ascending: false }).limit(200),
    [],
  )
  return (
    <ListShell title="AI Errors" description="Errored runs. Provider errors fall back to the next model; all-fail runs land here." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI', href: '/app/ai' }, { label: 'Errors' }]}>
      {!runs.ok ? (
        <ErrorState description={runs.kind === 'not_configured' ? 'Database not configured.' : runs.message} />
      ) : runs.data.length === 0 ? (
        <EmptyState title="No errors" description="No errored agent runs." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Agent</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{new Date(r.started_at).toLocaleString('en-US')}</TableCell>
                  <TableCell><Link href={`/app/ai/runs/${r.id}`} className="font-medium text-primary hover:underline">{r.agent_key}</Link></TableCell>
                  <TableCell className="max-w-lg truncate text-destructive">{r.error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
