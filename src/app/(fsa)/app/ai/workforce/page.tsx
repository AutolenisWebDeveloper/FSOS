import Link from 'next/link'
import { DashboardShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip } from '@/components/ui/securities'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { RunWorkforceButton } from '@/components/app/RunWorkforceButton'
import { FnaPlanningIntelligence } from '@/components/fna/FnaPlanningIntelligence'
import {
  executiveStatus,
  resultsToday,
  rosterHealth,
  attentionItems,
  heldCount,
  type WorkforceRow,
  type QueueRow,
  type EscalationRow,
  type ComplianceEventRow,
  type AttentionSeverity,
  type WorkerHealth,
} from '@/lib/ai/command-center'

export const dynamic = 'force-dynamic'

// Friendly labels for the outreach agents (the ones that proactively contact clients).
const AGENT_LABEL: Record<string, string> = {
  cross_sell: 'Cross-Sell',
  term_conversion: 'Term Conversion',
  referral_followup: 'Referral Follow-Up',
  marketing_automation: 'Marketing / Win-Back',
}

const SOURCE_LABEL: Record<string, string> = {
  cross_sell: 'Coverage gap',
  term_conversion: 'Conversion window',
  referral_followup: 'New referral',
  win_back: 'Win-back',
}

const HEALTH_LABEL: Record<WorkerHealth, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  idle: 'Idle',
}

// Severity → badge variant + a text label (color is never the only signal, §31 a11y).
const SEVERITY_BADGE: Record<AttentionSeverity, { variant: 'blocked' | 'escalated' | 'pending' | 'secondary'; label: string }> = {
  critical: { variant: 'blocked', label: 'Critical' },
  high: { variant: 'escalated', label: 'Escalated' },
  medium: { variant: 'pending', label: 'Blocked' },
  low: { variant: 'secondary', label: 'Review' },
}

function statusVariant(s: string): 'won' | 'lost' | 'blocked' | 'default' | 'secondary' {
  if (s === 'sent') return 'won'
  if (s === 'blocked') return 'blocked'
  if (s === 'escalated') return 'lost'
  if (s === 'skipped' || s === 'held') return 'secondary'
  return 'default'
}

// AI Command Center (evolves OS-15 AI Workforce) — the operational cockpit for the
// autonomous employees. It COMPOSES data the workforce already produces
// (v_workforce_today, outreach_queue, agent_actions escalations, compliance_events)
// into: an executive status band, a ranked "needs your attention" queue (the
// human-in-the-loop surface), per-agent roster health, the day's results, and the
// live outreach queue. Every send here went through the 7-step compliance gate;
// securities-flagged records are surfaced as firewall items and NEVER contacted.
export default async function CommandCenterPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [summary, queue, escalations, events] = await Promise.all([
    load<WorkforceRow[]>((db) => db.from('v_workforce_today').select('*').order('agent_key'), []),
    load<QueueRow[]>(
      (db) =>
        db
          .from('outreach_queue')
          .select('id, agent_key, source, channel, priority, reason, status, block_reason, outcome, is_security, entity_type, household_id')
          .eq('queue_date', today)
          .order('priority', { ascending: false })
          .limit(200),
      [],
    ),
    load<EscalationRow[]>(
      (db) =>
        db
          .from('agent_actions')
          .select('id, reason, target_type, target_id, note, blocked_step, created_at')
          .eq('kind', 'escalation')
          .order('created_at', { ascending: false })
          .limit(25),
      [],
    ),
    load<ComplianceEventRow[]>(
      (db) =>
        db
          .from('compliance_events')
          .select('id, kind, reason, blocked_step, channel, created_at')
          .order('created_at', { ascending: false })
          .limit(25),
      [],
    ),
  ])

  if (!summary.ok) {
    return (
      <DashboardShell title="AI Command Center">
        {summary.kind === 'not_configured' ? (
          <EmptyState title="Database not configured" description="Set the Supabase environment variables to bring the AI workforce online." />
        ) : (
          <ErrorState description={summary.message} />
        )}
      </DashboardShell>
    )
  }

  const workforce = summary.data
  const queueRows = queue.ok ? queue.data : []
  const status = executiveStatus(workforce)
  const held = heldCount(queueRows)
  const results = resultsToday(workforce)
  const roster = rosterHealth(workforce)
  const attention = attentionItems(queueRows, escalations.ok ? escalations.data : [], events.ok ? events.data : [])
  const attentionCount = attention.length

  return (
    <DashboardShell
      title="AI Command Center"
      description="Your autonomous employees at work. Each agent has a daily contact quota; every message is drafted green-zone and sent only through the compliance gate. Blocks, escalations and firewall records surface here for you."
    >
      <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/app/ai" className="text-primary hover:underline">AI Operations</Link>
          <span>·</span>
          <Link href="/app/ai/escalations" className="text-primary hover:underline">Escalations</Link>
          <span>·</span>
          <Link href="/super/ai/targets" className="text-primary hover:underline">Manage quotas</Link>
          <span>·</span>
          <Link href="/super/ai/hours" className="text-primary hover:underline">Hours of operation</Link>
          <span>·</span>
          <Link href="/super/ai/policies" className="text-primary hover:underline">Kill switch</Link>
        </div>
        <RunWorkforceButton />
      </div>

      {/* Executive status band */}
      <StatTile
        label="Working now"
        value={status.activeWorkers}
        hint={`${status.pausedWorkers} paused · ${status.offWorkers} off`}
      />
      <StatTile label="Sent today" value={status.completedToday} href="/app/comms/campaigns" hint="Completed client contact" />
      <StatTile label="In progress" value={status.inProgress} hint="Queued + drafted" />
      <StatTile
        label="Needs your attention"
        value={attentionCount}
        href="/app/ai/escalations"
        tone={attentionCount > 0 ? 'attention' : 'neutral'}
        hint={`${status.escalations} escalated · ${status.failedToday} blocked · ${held} held`}
      />

      {/* Needs your attention — the human-in-the-loop surface */}
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">Needs your attention</h2>
        {attentionCount === 0 ? (
          <EmptyState
            title="Nothing waiting on you"
            description="No escalations, blocked sends, or firewall records right now. The workforce escalates anything it can't safely handle here."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Severity</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attention.slice(0, 12).map((a) => {
                  const sev = SEVERITY_BADGE[a.severity]
                  return (
                    <TableRow key={a.key}>
                      <TableCell>
                        <Badge variant={sev.variant}>{sev.label}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {a.isSecurity ? <SecuritiesChip /> : null}
                          {a.title}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-muted-foreground">{a.detail}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {attentionCount > 12 ? (
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                Showing 12 of {attentionCount}. <Link href="/app/ai/escalations" className="text-primary hover:underline">See all escalations →</Link>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Roster health */}
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">AI employee roster</h2>
        {roster.length === 0 ? (
          <EmptyState title="No quotas configured" description="Set each agent's daily contact target under Manage quotas to put the workforce to work." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>In progress</TableHead>
                  <TableHead>Blocked / esc</TableHead>
                  <TableHead>Engaged</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((r) => (
                  <TableRow key={r.agentKey}>
                    <TableCell className="font-medium">
                      {AGENT_LABEL[r.agentKey] ?? r.agentKey}
                      {r.isAssumption ? <span className="ml-2 inline-block"><AssumptionBadge /></span> : null}
                    </TableCell>
                    <TableCell className="uppercase text-xs text-muted-foreground">{r.channel}</TableCell>
                    <TableCell>
                      {r.sent}/{r.dailyTarget}
                      <span className="text-muted-foreground text-xs"> ({r.remaining} left)</span>
                    </TableCell>
                    <TableCell>{r.sent}</TableCell>
                    <TableCell>{r.inProgress}</TableCell>
                    <TableCell>{r.blockedEscalated}</TableCell>
                    <TableCell>{r.engaged}</TableCell>
                    <TableCell>
                      <Badge variant={r.health === 'healthy' ? 'won' : r.health === 'degraded' ? 'escalated' : 'secondary'}>
                        {HEALTH_LABEL[r.health]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'working' ? 'active' : 'lost'}>
                        {r.status === 'agent_off' ? 'agent off' : r.status === 'paused' ? 'paused' : 'working'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Results today */}
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">Results today</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Messages sent</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{results.sent}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Engaged</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{results.engaged}</p>
            <p className="mt-1 text-xs text-muted-foreground">Replied / booked / converted</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Blocked</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{results.blocked}</p>
            <p className="mt-1 text-xs text-muted-foreground">Refused by the gate</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Escalated</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{results.escalated}</p>
            <p className="mt-1 text-xs text-muted-foreground">Routed to you</p>
          </div>
        </div>
      </div>

      {/* Operational timeline — today's outreach queue */}
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">Today&apos;s outreach queue</h2>
        {queueRows.length === 0 ? (
          <EmptyState title="Queue is empty" description="The orchestrator builds the queue each morning (or when you run it now). Detection jobs feed it: coverage gaps, conversion windows, and new referrals." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Why now</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueRows.slice(0, 50).map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="tabular-nums">{q.priority}</TableCell>
                    <TableCell>{AGENT_LABEL[q.agent_key] ?? q.agent_key}</TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABEL[q.source] ?? q.source}</TableCell>
                    <TableCell className="max-w-sm truncate text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        {q.is_security ? <SecuritiesChip /> : null}
                        {q.reason ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(q.status)}>{q.status}</Badge>
                      {q.block_reason ? <span className="ml-2 text-xs text-muted-foreground">{q.block_reason}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {/* Slice 10 — planning intelligence on the existing command center. */}
        <FnaPlanningIntelligence />
      </div>
    </DashboardShell>
  )
}
