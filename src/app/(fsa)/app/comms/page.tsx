import Link from 'next/link'
import {
  ListShell,
  ErrorState,
  EmptyState,
  Section,
  StatTile,
} from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { MessageLogTable } from '@/components/comms/MessageLogTable'
import { loadMessageLog } from '@/lib/comms/message-log'
import { loadCount } from '@/lib/data/query'
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Inbox,
  MessageSquareReply,
  Send,
  ShieldOff,
  Split,
  UserCog,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'
import type { Tone } from '@/components/dashboards/primitives'

export const dynamic = 'force-dynamic'

// Slice 9A — /app/comms is the AI Communications Center OVERVIEW: operational state at a
// glance (not a redirect). Every tile links to the surface that resolves it. Sub-navigation
// lives in the comms layout. No route changes.
//
// This page used to declare a LOCAL `StatTile` (a flat bordered div) while the canonical
// `StatTile`/`MetricCard` — icon chip, hover lift, affordance arrow, tone system — already
// existed in the archetypes barrel it was importing from. The hub of the comms workspace
// was the one screen rendering visibly cheaper tiles than the rest of FSOS. It also
// hand-rolled a `countOf` wrapper that duplicates `loadCount` from lib/data/query.
//
// The ten metrics were a flat 5-across wall with no ranking, so "delegation exceptions"
// (act now) sat at the same weight as "sent today" (ambient). They are now banded by what
// the advisor is supposed to DO with them.

type Metric = {
  label: string
  value: number
  href: string
  hint: string
  icon: LucideIcon
  /** `attention`/`critical` only when the number is non-zero — a calm board when clean. */
  tone?: Tone
}

function startOfTodayISO(): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

async function loadMetrics() {
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
    loadCount((db) => db.from('comm_campaigns').select('id', head).eq('status', 'active').is('archived_at', null)),
    loadCount((db) => db.from('comm_templates').select('id', head).eq('approval_status', 'submitted').is('archived_at', null)),
    loadCount((db) => db.from('comm_conversations').select('id', head).eq('status', 'open')),
    loadCount((db) => db.from('comm_messages').select('id', head).eq('direction', 'inbound').gte('created_at', daysAgoISO(2))),
    loadCount((db) => db.from('comm_assignment_reviews').select('id', head).eq('status', 'open')),
    loadCount((db) => db.from('agency_communication_delegations').select('id', head).in('status', ['SUSPENDED', 'EXPIRED', 'REVOKED'])),
    loadCount((db) => db.from('dnc_entries').select('id', head).gte('created_at', wk)),
    loadCount((db) => db.from('comm_messages').select('id', head).in('delivery_status', ['failed', 'bounced']).gte('created_at', wk)),
    loadCount((db) => db.from('comm_messages').select('id', head).in('blocked_step', ['quiet_hours', 'frequency']).gte('created_at', wk)),
    loadCount((db) => db.from('comm_messages').select('id', head).eq('direction', 'outbound').in('delivery_status', ['sent', 'delivered']).gte('created_at', today)),
  ])

  const attention: Metric[] = [
    { label: 'Delegation exceptions', value: delegationExceptions, href: '/app/comms/assignments', hint: 'Suspended, expired, or revoked', icon: ShieldOff, tone: delegationExceptions ? 'critical' : 'neutral' },
    { label: 'Delivery failures', value: deliveryFailures, href: '/app/comms/delivery', hint: 'Failed or bounced, last 7 days', icon: AlertTriangle, tone: deliveryFailures ? 'critical' : 'neutral' },
    { label: 'Pending approvals', value: pendingApprovals, href: '/app/comms/templates', hint: 'Templates awaiting review', icon: CheckCheck, tone: pendingApprovals ? 'attention' : 'neutral' },
    { label: 'Assignment review', value: assignmentDepth, href: '/app/comms/assignments', hint: 'Ownership queue depth', icon: UserCog, tone: assignmentDepth ? 'attention' : 'neutral' },
  ]

  const inFlight: Metric[] = [
    { label: 'Sent today', value: sendVolume, href: '/app/comms/delivery', hint: 'Outbound sent or delivered', icon: Send, tone: 'brand' },
    { label: 'Active campaigns', value: activeCampaigns, href: '/app/comms/campaigns', hint: 'Currently dispatching', icon: Megaphone, tone: 'brand' },
    { label: 'Awaiting response', value: awaitingResponse, href: '/app/comms/inbox', hint: 'Open conversations', icon: Inbox, tone: awaitingResponse ? 'attention' : 'neutral' },
    { label: 'Recent replies', value: unreadReplies, href: '/app/comms/inbox', hint: 'Inbound, last 48 hours', icon: MessageSquareReply },
  ]

  const gate: Metric[] = [
    { label: 'Held by the gate', value: hourFreqBlocks, href: '/app/comms/delivery', hint: 'Quiet hours or frequency, last 7 days', icon: Clock },
    { label: 'New suppressions', value: suppression, href: '/app/comms/suppression', hint: 'Opt-outs and DNC, last 7 days', icon: Split },
  ]

  return { attention, inFlight, gate }
}

function TileRow({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => (
        <StatTile key={m.label} label={m.label} value={m.value} href={m.href} hint={m.hint} icon={m.icon} tone={m.tone ?? 'neutral'} />
      ))}
    </div>
  )
}

export default async function CommsOverviewPage() {
  const [{ attention, inFlight, gate }, msgs] = await Promise.all([loadMetrics(), loadMessageLog({ limit: 50 })])

  return (
    <ListShell
      title="AI Communications Center"
      description="Operational state across every outbound and inbound surface. Blocked and deferred sends are shown, never hidden."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI Communications Center' }]}
      actions={
        <Button asChild>
          <Link href="/app/comms/console">Open console</Link>
        </Button>
      }
    >
      <div className="space-y-section">
        <Section title="Needs attention" description="Queues where a send is waiting on a person.">
          <TileRow metrics={attention} />
        </Section>

        <Section title="In flight" description="What the system is doing right now.">
          <TileRow metrics={inFlight} />
        </Section>

        <Section title="Gate activity" description="Sends the gate held or suppressed. Held is not dropped — each one retries or escalates.">
          <TileRow metrics={gate} />
        </Section>

        <Section
          title="Recent messages"
          description="The last 50 sends across every channel, with the gate result for each."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link href="/app/comms/delivery">View delivery queue</Link>
            </Button>
          }
        >
          {!msgs.ok ? (
            <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
          ) : msgs.data.length === 0 ? (
            <EmptyState
              title="No messages yet"
              description="Automated and one-off sends appear here with the gate result that let them through or held them."
              action={
                <Button asChild>
                  <Link href="/app/comms/console">Open console</Link>
                </Button>
              }
            />
          ) : (
            <MessageLogTable rows={msgs.data} caption="The 50 most recent messages across all channels" />
          )}
        </Section>
      </div>
    </ListShell>
  )
}
