import { ReportShell, ErrorState, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-12 Comms Analytics (A11). Send / response / opt-out rates.
export default async function CommsAnalyticsPage() {
  const [msgs, revoked] = await Promise.all([
    load<{ delivery_status: string; direction: string }[]>((db) => db.from('comm_messages').select('delivery_status, direction').limit(10000), []),
    load<{ id: string }[]>((db) => db.from('consents').select('id').eq('status', 'revoked').limit(5000), []),
  ])
  if (!msgs.ok) return <ReportShell title="Comms Analytics"><ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} /></ReportShell>
  const rows = msgs.data
  const sent = rows.filter((m) => m.delivery_status === 'sent' || m.delivery_status === 'delivered').length
  const blocked = rows.filter((m) => m.delivery_status === 'blocked').length
  const inbound = rows.filter((m) => m.direction === 'inbound').length
  const optOuts = revoked.ok ? revoked.data.length : 0

  return (
    <ReportShell title="Comms Analytics" description="Send / response / opt-out rates. Export from the Reports library.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sent" value={sent} href="/app/comms" />
        <StatTile label="Blocked" value={blocked} href="/app/comms/delivery" />
        <StatTile label="Inbound responses" value={inbound} href="/app/comms" />
        <StatTile label="Opt-outs" value={optOuts} href="/app/comms/suppression" />
      </div>
    </ReportShell>
  )
}
