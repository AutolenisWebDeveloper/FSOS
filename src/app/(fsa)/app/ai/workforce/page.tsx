import Link from 'next/link'
import { DashboardShell, StatTile, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { RunWorkforceButton } from '@/components/app/RunWorkforceButton'

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

interface WorkforceRow {
  agent_key: string
  agent_enabled: boolean
  daily_target: number
  channel: string
  target_enabled: boolean
  is_assumption: boolean
  queued_total: number
  sent: number
  blocked: number
  escalated: number
  skipped: number
  pending: number
  drafted: number
  engaged: number
  remaining: number
}

interface QueueRow {
  id: string
  agent_key: string
  source: string
  channel: string
  priority: number
  reason: string | null
  status: string
  block_reason: string | null
  outcome: string | null
}

function statusVariant(s: string): 'won' | 'lost' | 'blocked' | 'default' | 'secondary' {
  if (s === 'sent') return 'won'
  if (s === 'blocked') return 'blocked'
  if (s === 'escalated') return 'lost'
  if (s === 'skipped' || s === 'held') return 'secondary'
  return 'default'
}

// OS-15 AI Workforce — the operating view of the autonomous employees. Shows each
// outreach agent's daily contact quota vs. what it has queued / sent / blocked /
// escalated today, and the live outreach queue. Every send here went through the
// 7-step compliance gate; blocks/escalations are the human-handoff surface.
export default async function WorkforcePage() {
  const [summary, queue] = await Promise.all([
    load<WorkforceRow[]>((db) => db.from('v_workforce_today').select('*').order('agent_key'), []),
    load<QueueRow[]>(
      (db) =>
        db
          .from('outreach_queue')
          .select('id, agent_key, source, channel, priority, reason, status, block_reason, outcome')
          .eq('queue_date', new Date().toISOString().slice(0, 10))
          .order('priority', { ascending: false })
          .limit(50),
      [],
    ),
  ])

  if (!summary.ok) {
    return (
      <DashboardShell title="AI Workforce">
        {summary.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={summary.message} />}
      </DashboardShell>
    )
  }

  const rows = summary.data.filter((r) => r.daily_target > 0 || r.queued_total > 0)
  const totalTarget = rows.reduce((s, r) => s + r.daily_target, 0)
  const totalSent = rows.reduce((s, r) => s + r.sent, 0)
  const totalBlocked = rows.reduce((s, r) => s + r.blocked, 0)
  const totalEscalated = rows.reduce((s, r) => s + r.escalated, 0)
  const totalPending = rows.reduce((s, r) => s + r.pending + r.drafted, 0)

  return (
    <DashboardShell
      title="AI Workforce"
      description="Your autonomous employees at work. Each agent has a daily contact quota; every message is drafted green-zone and sent only through the compliance gate."
    >
      <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href="/app/ai" className="text-primary hover:underline">← AI Operations</Link>
          <span>·</span>
          <Link href="/app/ai/escalations" className="text-primary hover:underline">Escalations</Link>
          <span>·</span>
          <Link href="/super/ai/targets" className="text-primary hover:underline">Manage quotas</Link>
        </div>
        <RunWorkforceButton />
      </div>

      <StatTile label="Daily contact target" value={totalTarget} hint="Across all outreach agents" />
      <StatTile label="Sent today" value={totalSent} href="/app/comms/campaigns" />
      <StatTile label="In progress" value={totalPending} hint="Queued + drafted" />
      <StatTile label="Blocked / escalated" value={totalBlocked + totalEscalated} href="/app/ai/escalations" hint="Routed to you" />

      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">Today by agent</h2>
        {rows.length === 0 ? (
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.agent_key}>
                    <TableCell className="font-medium">
                      {AGENT_LABEL[r.agent_key] ?? r.agent_key}
                      {r.is_assumption ? <span className="ml-2 inline-block"><AssumptionBadge /></span> : null}
                    </TableCell>
                    <TableCell className="uppercase text-xs text-muted-foreground">{r.channel}</TableCell>
                    <TableCell>{r.sent}/{r.daily_target}<span className="text-muted-foreground text-xs"> ({r.remaining} left)</span></TableCell>
                    <TableCell>{r.sent}</TableCell>
                    <TableCell>{r.pending + r.drafted}</TableCell>
                    <TableCell>{r.blocked + r.escalated}</TableCell>
                    <TableCell>{r.engaged}</TableCell>
                    <TableCell>
                      <Badge variant={r.agent_enabled && r.target_enabled ? 'won' : 'lost'}>
                        {!r.agent_enabled ? 'agent off' : !r.target_enabled ? 'paused' : 'working'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <h2 className="text-sm font-semibold">Today&apos;s outreach queue</h2>
        {!queue.ok || queue.data.length === 0 ? (
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
                {queue.data.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="tabular-nums">{q.priority}</TableCell>
                    <TableCell>{AGENT_LABEL[q.agent_key] ?? q.agent_key}</TableCell>
                    <TableCell className="text-muted-foreground">{SOURCE_LABEL[q.source] ?? q.source}</TableCell>
                    <TableCell className="max-w-sm truncate text-muted-foreground">{q.reason ?? '—'}</TableCell>
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
      </div>
    </DashboardShell>
  )
}
