import { ListShell, ErrorState, EmptyState, Section, StatTile } from '@/components/archetypes'
import { MessageLogTable } from '@/components/comms/MessageLogTable'
import { loadMessageLog } from '@/lib/comms/message-log'
import { loadCount } from '@/lib/data/query'
import { AlertTriangle, Clock, ShieldOff, Send } from 'lucide-react'

export const dynamic = 'force-dynamic'

// OS-12 Delivery (A2). sent/delivered/failed/blocked with retry (idempotent).
//
// The tally previously fetched up to 5,000 `delivery_status` rows and counted them in
// JS — five columns of a table pulled over the wire to produce four integers, and
// silently wrong past 5,000 rows. These are exact head-only counts now (no rows
// transferred), which is both correct at any volume and materially cheaper.
export default async function DeliveryPage() {
  const head = { count: 'exact' as const, head: true }
  const [msgs, sent, blocked, failed, queued] = await Promise.all([
    loadMessageLog({ statuses: ['failed', 'bounced', 'blocked'], limit: 300 }),
    loadCount((db) => db.from('comm_messages').select('id', head).in('delivery_status', ['sent', 'delivered'])),
    loadCount((db) => db.from('comm_messages').select('id', head).eq('delivery_status', 'blocked')),
    loadCount((db) => db.from('comm_messages').select('id', head).in('delivery_status', ['failed', 'bounced'])),
    loadCount((db) => db.from('comm_messages').select('id', head).eq('delivery_status', 'queued')),
  ])

  return (
    <ListShell
      title="Delivery"
      description="Failed and held messages. Failed sends retry idempotently; a held send is never silently dropped."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Delivery' }]}
    >
      <div className="space-y-section">
        <Section title="Delivery state" description="Every message FSOS has attempted, by outcome.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sent" value={sent} hint="Accepted or confirmed delivered" icon={Send} tone="brand" />
            <StatTile label="Held by the gate" value={blocked} href="/app/comms/delivery" hint="Awaiting a person or a later cycle" icon={ShieldOff} tone={blocked ? 'attention' : 'neutral'} />
            <StatTile label="Failed" value={failed} href="/app/comms/delivery" hint="Rejected or bounced" icon={AlertTriangle} tone={failed ? 'critical' : 'neutral'} />
            <StatTile label="Queued" value={queued} hint="Passed the gate, awaiting dispatch" icon={Clock} />
          </div>
        </Section>

        <Section title="Exceptions" description="Held and failed sends, most recent first. The gate column says which step stopped it.">
          {!msgs.ok ? (
            <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
          ) : msgs.data.length === 0 ? (
            <EmptyState title="Nothing held or failed" description="Every send in range cleared the gate and was accepted by its provider." />
          ) : (
            <MessageLogTable rows={msgs.data} caption="Held and failed messages, most recent first" showDirection={false} />
          )}
        </Section>
      </div>
    </ListShell>
  )
}
