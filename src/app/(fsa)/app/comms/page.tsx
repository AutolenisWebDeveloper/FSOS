import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { getDb } from '@/lib/supabase/client'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// Slice 9A — /app/comms is the AI Communications Center OVERVIEW: operational state at a
// glance (not a redirect). Every tile links to the surface that resolves it. Sub-navigation
// lives in the comms layout. No route changes.

type Metric = { label: string; value: number | null; href: string; hint: string; tone?: 'default' | 'warn' | 'danger' }

function startOfTodayISO(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

/** Count rows for a filtered query, config-safe. Returns null when unavailable (→ "—"). */
type CountQuery = PromiseLike<{ count: number | null; error: unknown }>
async function countOf(build: (db: ReturnType<typeof getDb>) => CountQuery): Promise<number | null> {
  try {
    const { count, error } = await build(getDb())
    return error ? null : count ?? 0
  } catch {
    return null
  }
}

async function loadMetrics(): Promise<Metric[]> {
  const today = startOfTodayISO()
  const wk = daysAgoISO(7)
  const head = { count: 'exact' as const, head: true }

  const [
    activeCampaigns,
    pendingApprovals,
    awaitingResponse,
    unreadReplies,
    assignmentDepth,
    delegationExceptions,
    suppression,
    deliveryFailures,
    hourFreqBlocks,
    sendVolume,
  ] = await Promise.all([
    countOf((db) => db.from('comm_campaigns').select('id', head).eq('status', 'active').is('archived_at', null)),
    countOf((db) => db.from('comm_templates').select('id', head).eq('approval_status', 'submitted').is('archived_at', null)),
    countOf((db) => db.from('comm_conversations').select('id', head).eq('status', 'open')),
    countOf((db) => db.from('comm_messages').select('id', head).eq('direction', 'inbound').gte('created_at', daysAgoISO(2))),
    countOf((db) => db.from('comm_assignment_reviews').select('id', head).eq('status', 'open')),
    countOf((db) => db.from('agency_communication_delegations').select('id', head).in('status', ['SUSPENDED', 'EXPIRED', 'REVOKED'])),
    countOf((db) => db.from('dnc_entries').select('id', head).gte('created_at', wk)),
    countOf((db) => db.from('comm_messages').select('id', head).in('delivery_status', ['failed', 'bounced']).gte('created_at', wk)),
    countOf((db) => db.from('comm_messages').select('id', head).in('blocked_step', ['quiet_hours', 'frequency']).gte('created_at', wk)),
    countOf((db) => db.from('comm_messages').select('id', head).eq('direction', 'outbound').in('delivery_status', ['sent', 'delivered']).gte('created_at', today)),
  ])

  return [
    { label: 'Active campaigns', value: activeCampaigns, href: '/app/comms/campaigns', hint: 'Currently dispatching' },
    { label: 'Pending approvals', value: pendingApprovals, href: '/app/comms/templates', hint: 'Templates awaiting review', tone: pendingApprovals ? 'warn' : 'default' },
    { label: 'Awaiting response', value: awaitingResponse, href: '/app/comms/inbox', hint: 'Open conversations', tone: awaitingResponse ? 'warn' : 'default' },
    { label: 'Recent replies', value: unreadReplies, href: '/app/comms/inbox', hint: 'Inbound in last 48h' },
    { label: 'Assignment review', value: assignmentDepth, href: '/app/comms/assignments', hint: 'Ownership queue depth', tone: assignmentDepth ? 'warn' : 'default' },
    { label: 'Delegation exceptions', value: delegationExceptions, href: '/app/comms/assignments', hint: 'Suspended / expired / revoked', tone: delegationExceptions ? 'danger' : 'default' },
    { label: 'Suppression (7d)', value: suppression, href: '/app/comms/suppression', hint: 'New opt-outs / DNC' },
    { label: 'Delivery failures (7d)', value: deliveryFailures, href: '/app/comms/delivery', hint: 'Failed / bounced', tone: deliveryFailures ? 'danger' : 'default' },
    { label: 'Quiet-hour / frequency blocks (7d)', value: hourFreqBlocks, href: '/app/comms/delivery', hint: 'Deferred by the gate' },
    { label: 'Sent today', value: sendVolume, href: '/app/comms/delivery', hint: 'Outbound delivered/sent' },
  ]
}

function StatTile({ m }: { m: Metric }) {
  const toneClass = m.tone === 'danger' ? 'text-destructive' : m.tone === 'warn' ? 'text-status-pending' : 'text-foreground'
  return (
    <Link href={m.href} className="rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/40">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{m.label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}><Numeric>{m.value === null ? '—' : m.value}</Numeric></p>
      <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
    </Link>
  )
}

export default async function CommsOverviewPage() {
  const metrics = await loadMetrics()
  const msgs = await load<{ id: string; channel: string; direction: string; recipient: string | null; delivery_status: string; blocked_step: string | null; consent_at_send: boolean | null; created_at: string }[]>(
    (db) => db.from('comm_messages').select('id, channel, direction, recipient, delivery_status, blocked_step, consent_at_send, created_at').order('created_at', { ascending: false }).limit(50),
    [],
  )

  return (
    <ListShell
      title="AI Communications Center"
      description="Operational state across every outbound and inbound surface. Blocked and deferred sends are shown, never hidden."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI Communications Center' }]}
    >
      <div className="space-y-6">
        <section aria-label="Operational metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {metrics.map((m) => (<StatTile key={m.label} m={m} />))}
        </section>

        <section aria-label="Recent activity" className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Recent messages</h2>
          {!msgs.ok ? (
            <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
          ) : msgs.data.length === 0 ? (
            <EmptyState title="No messages yet" description="Automated and one-off messages appear here with their gate result." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Channel</TableHead><TableHead>Recipient</TableHead><TableHead>Status</TableHead><TableHead>Gate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {msgs.data.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground"><Numeric>{new Date(m.created_at).toLocaleString('en-US')}</Numeric></TableCell>
                      <TableCell><Badge variant="outline">{m.channel}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{m.recipient ?? '—'}</TableCell>
                      <TableCell><Badge variant={m.delivery_status === 'blocked' ? 'blocked' : m.delivery_status === 'failed' ? 'lost' : m.delivery_status === 'delivered' || m.delivery_status === 'sent' ? 'won' : 'pending'}>{m.delivery_status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.blocked_step ? `blocked: ${m.blocked_step}` : m.consent_at_send ? 'consent on file' : 'sent'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </ListShell>
  )
}
