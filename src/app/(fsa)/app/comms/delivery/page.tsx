import { ListShell, ErrorState, StatTile } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-12 Delivery (A2). sent/delivered/failed/blocked with retry (idempotent).
export default async function DeliveryPage() {
  const msgs = await load<{ id: string; channel: string; recipient: string | null; delivery_status: string; block_reason: string | null; created_at: string }[]>(
    (db) => db.from('comm_messages').select('id, channel, recipient, delivery_status, block_reason, created_at').in('delivery_status', ['failed', 'blocked']).order('created_at', { ascending: false }).limit(300),
    [],
  )
  const counts = await load<{ delivery_status: string }[]>((db) => db.from('comm_messages').select('delivery_status').limit(5000), [])
  const tally = (s: string) => (counts.ok ? counts.data.filter((m) => m.delivery_status === s).length : 0)

  return (
    <ListShell title="Delivery" description="Failed and blocked messages. Failed sends retry idempotently; blocked never silently dropped." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Delivery' }]}>
      {!msgs.ok ? (
        <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sent" value={tally('sent') + tally('delivered')} href="/app/comms" />
            <StatTile label="Blocked" value={tally('blocked')} href="/app/comms/delivery" />
            <StatTile label="Failed" value={tally('failed')} href="/app/comms/delivery" />
            <StatTile label="Queued" value={tally('queued')} href="/app/comms/delivery" />
          </div>
          {msgs.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed or blocked messages.</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Channel</TableHead><TableHead>Recipient</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                <TableBody>
                  {msgs.data.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">{new Date(m.created_at).toLocaleString('en-US')}</TableCell>
                      <TableCell><Badge variant="outline">{m.channel}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{m.recipient ?? '—'}</TableCell>
                      <TableCell><Badge variant={m.delivery_status === 'blocked' ? 'blocked' : 'lost'}>{m.delivery_status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.block_reason ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </ListShell>
  )
}
