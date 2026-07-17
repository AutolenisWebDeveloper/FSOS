import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { WorkflowControls } from '@/components/app/WorkflowBuilder'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface WorkflowCondition {
  field: string
  op: string
  value?: string | number | boolean
}
interface WorkflowStep {
  type: string
  action?: string
  delay_hours?: number
}
interface FailurePolicy {
  max_retries?: number
  backoff?: string
}
interface WorkflowDetail {
  id: string
  name: string
  description: string | null
  trigger_type: string
  trigger_config: Record<string, unknown> | null
  conditions: WorkflowCondition[] | null
  steps: WorkflowStep[] | null
  failure_policy: FailurePolicy | null
  enabled: boolean
  created_at: string
}
interface RunRow {
  id: string
  status: string
  current_step: number | null
  attempts: number | null
  last_error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

function runStatus(status: string): 'won' | 'lost' | 'active' | 'pending' {
  if (status === 'succeeded' || status === 'completed') return 'won'
  if (status === 'failed' || status === 'error') return 'lost'
  if (status === 'running' || status === 'in_progress') return 'active'
  return 'pending'
}

// OS-14 Workflow Detail (A3 DetailShell).
export default async function WorkflowDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const res = await load<WorkflowDetail | null>(
    (db) => db.from('automation_workflows').select('*').eq('id', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const w = res.data
  if (!w) notFound()

  const runsRes = await load<RunRow[]>(
    (db) => db.from('automation_runs').select('id, status, current_step, attempts, last_error, started_at, finished_at, created_at').eq('workflow_id', params.id).order('created_at', { ascending: false }).limit(20),
    [],
  )
  const runs = runsRes.ok ? runsRes.data : []
  const conditions = Array.isArray(w.conditions) ? w.conditions : []
  const steps = Array.isArray(w.steps) ? w.steps : []

  return (
    <DetailShell
      title={w.name}
      description={w.description ?? undefined}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Workflows', href: '/app/workflows' }, { label: w.name }]}
      status={w.enabled ? <StatusBadge status="won" label="enabled" /> : <StatusBadge status="draft" label="inactive" />}
      actions={<WorkflowControls id={w.id} enabled={w.enabled} />}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Related</p>
          <ul className="space-y-1.5">
            <li><Link href="/app/workflows" className="text-primary hover:underline">All workflows</Link></li>
            <li><Link href="/app/tasks" className="text-primary hover:underline">Tasks</Link></li>
          </ul>
          <p className="text-xs text-muted-foreground">Comm-sending steps still pass the comms dispatcher gate — consent, quiet-hours, DNC, and securities checks are never bypassed.</p>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Trigger</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Type</span>
              <span className="font-medium capitalize">{w.trigger_type.replace(/_/g, ' ')}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Failure policy</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Max retries</span>
              <span className="font-medium">{w.failure_policy?.max_retries ?? 0}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Backoff</span>
              <span className="font-medium capitalize">{w.failure_policy?.backoff ?? 'exponential'}</span>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Conditions</CardTitle></CardHeader>
        <CardContent>
          {conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conditions — runs for every matching trigger.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {conditions.map((c, i) => (
                <li key={i} className="font-mono text-xs">
                  {c.field} <span className="text-muted-foreground">{c.op}</span> {c.op === 'exists' ? '' : String(c.value ?? '')}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Steps</CardTitle></CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps defined.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium capitalize">{s.type}</span>
                  {s.type === 'action' && s.action ? <span className="text-muted-foreground">— {s.action.replace(/_/g, ' ')}</span> : null}
                  {s.type === 'delay' ? <span className="text-muted-foreground">— {s.delay_hours ?? 0}h</span> : null}
                  {s.type === 'branch' ? <span className="text-muted-foreground">— routes on conditions</span> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" description="This workflow has not executed. Runs appear here once it fires." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Finished</TableHead>
                  <TableHead>Last error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><StatusBadge status={runStatus(r.status)} label={r.status.replace(/_/g, ' ')} /></TableCell>
                    <TableCell>{r.attempts ?? 0}</TableCell>
                    <TableCell className="text-muted-foreground"><Numeric>{r.started_at ? new Date(r.started_at).toLocaleString('en-US') : '—'}</Numeric></TableCell>
                    <TableCell className="text-muted-foreground"><Numeric>{r.finished_at ? new Date(r.finished_at).toLocaleString('en-US') : '—'}</Numeric></TableCell>
                    <TableCell className="max-w-[16rem] truncate text-muted-foreground" title={r.last_error ?? undefined}>{r.last_error ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DetailShell>
  );
}
