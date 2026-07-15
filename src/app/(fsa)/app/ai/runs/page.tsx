import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-15 Runs (A2). Every run traceable end-to-end.
export default async function RunsPage() {
  const runs = await load<{ id: string; agent_key: string; status: string; model: string | null; cost_usd: number; confidence: number | null; started_at: string }[]>(
    (db) => db.from('agent_runs').select('id, agent_key, status, model, cost_usd, confidence, started_at').order('started_at', { ascending: false }).limit(200),
    [],
  )
  return (
    <ListShell title="Agent Runs" description="Every run logs inputs, model, tokens, cost, confidence, and guardrail result." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI', href: '/app/ai' }, { label: 'Runs' }]}>
      {!runs.ok ? (
        <ErrorState description={runs.kind === 'not_configured' ? 'Database not configured.' : runs.message} />
      ) : runs.data.length === 0 ? (
        <EmptyState title="No runs yet" description="Agent runs appear here as scheduled jobs fire." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Agent</TableHead><TableHead>Model</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Cost</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {runs.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-muted-foreground">{new Date(r.started_at).toLocaleString('en-US')}</TableCell>
                  <TableCell><Link href={`/app/ai/runs/${r.id}`} className="font-medium text-primary hover:underline">{r.agent_key}</Link></TableCell>
                  <TableCell className="text-muted-foreground">{r.model ?? '—'}</TableCell>
                  <TableCell>{r.confidence != null ? r.confidence.toFixed(2) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.cost_usd).toFixed(4)}</TableCell>
                  <TableCell><Badge variant={r.status === 'completed' ? 'won' : r.status === 'errored' ? 'lost' : 'pending'}>{r.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
