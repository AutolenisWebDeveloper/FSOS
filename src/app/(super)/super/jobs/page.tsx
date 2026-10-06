import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
import { AUTOMATIONS } from '@/lib/ops/automation-registry'
import { runState, RUN_STATE_LABEL, DAILY_STALE_MS, type RunState } from '@/lib/ops/automation-status'
export const dynamic = 'force-dynamic'

// P-6 Jobs. Every SCHEDULED automation from the registry (src/lib/ops/automation-registry.ts —
// the same list the #265 wiring guard holds against vercel.json), with what its last recorded run
// says. It listed a hard-coded 10 of the 25 crons (audit I-10). A failed run is now recorded
// (J-07), so it shows here as Failed instead of vanishing.
const STATE_VARIANT: Record<RunState, 'won' | 'lost' | 'pending' | 'outline'> = {
  succeeded: 'won',
  halted: 'pending',
  failed: 'lost',
  timed_out: 'lost',
  running: 'pending',
  stale: 'pending',
  none: 'outline',
}
// An hourly-window job (17:00–23:00 UTC) is idle 18 hours overnight; a day without a run is stale.
// A 5–15 minute route with no run in an hour has stopped.
const STALE_AFTER = { daily: DAILY_STALE_MS, hourly: 2 * 3600 * 1000, hourly_window: DAILY_STALE_MS, sub_hourly: 3600 * 1000 } as const
const CADENCE_LABEL = { daily: 'Daily', hourly: 'Hourly', hourly_window: 'Hourly, 17:00–23:00 UTC', sub_hourly: 'Every 5–15 min' } as const

export default async function SuperJobsPage() {
  const rows = await load<{ id: string; job: string; status: string; dedupe_key: string; error: string | null; started_at: string; finished_at: string | null }[]>(
    (db) => db.from('job_runs').select('id, job, status, dedupe_key, error, started_at, finished_at').order('started_at', { ascending: false }).limit(500),
    [],
  )
  const nowMs = Date.now()
  const latest = new Map<string, { status: string; started_at: string; finished_at: string | null; error: string | null }>()
  if (rows.ok) for (const r of rows.data) if (!latest.has(r.job)) latest.set(r.job, r)
  const scheduled = AUTOMATIONS.filter((a) => a.trigger.kind === 'cron' || a.trigger.kind === 'cron_route')

  return (
    <ListShell
      title="Jobs"
      description="Every scheduled automation and what its last recorded run says. A failed run is retried on the next schedule without duplication (dedupe key)."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Jobs' }]}
    >
      <div className="space-y-6">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Automation</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduled.map((a) => {
                // Static routes record their latest run under their route name (recordRouteRun, R17c).
                const job = a.trigger.kind === 'cron' ? a.trigger.job : a.trigger.kind === 'cron_route' ? a.trigger.route : null
                const cadence = a.cadence ?? 'daily'
                const run = job ? latest.get(job) : undefined
                const state = job && rows.ok ? runState(run, nowMs, STALE_AFTER[cadence]) : null
                return (
                  <TableRow key={a.key}>
                    <TableCell>
                      <span className="font-medium">{a.label}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{a.key}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{CADENCE_LABEL[cadence]}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {run ? <Numeric>{new Date(run.finished_at ?? run.started_at).toLocaleString('en-US')}</Numeric> : '—'}
                    </TableCell>
                    <TableCell>
                      {state ? (
                        <Badge variant={STATE_VARIANT[state]}>{RUN_STATE_LABEL[state]}</Badge>
                      ) : (
                        <Badge variant="outline">Unknown — run log unreadable</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No job runs yet" description="Cron job runs appear here once they fire." /> : (
          <div className="rounded-lg border"><Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
            <TableBody>{rows.data.slice(0, 200).map((r) => (<TableRow key={r.id}><TableCell className="text-muted-foreground"><Numeric>{new Date(r.started_at).toLocaleString('en-US')}</Numeric></TableCell><TableCell className="font-medium">{r.job}</TableCell><TableCell><Badge variant={r.status === 'completed' ? 'won' : r.status === 'errored' ? 'lost' : 'pending'}>{r.status}</Badge></TableCell><TableCell className="max-w-md truncate text-destructive">{r.error ?? '—'}</TableCell></TableRow>))}</TableBody>
          </Table></div>
        )}
      </div>
    </ListShell>
  )
}
