import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-12 Sms Inbox (A2). Replying to a securities-flagged thread is blocked + escalated;
// opt-out (STOP) is honored immediately via the consent/DNC sync.
export default async function Page() {
  const msgs = await load<{ id: string; direction: string; recipient: string | null; body: string | null; delivery_status: string; blocked_step: string | null; created_at: string }[]>(
    (db) => db.from('comm_messages').select('id, direction, recipient, body, delivery_status, blocked_step, created_at').eq('channel', 'sms').order('created_at', { ascending: false }).limit(200),
    [],
  )
  return (
    <ListShell title="Sms Inbox" description="Consented Sms threads. Replies pass the gate; STOP opts out immediately." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Sms' }]}>
      {!msgs.ok ? (
        <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
      ) : msgs.data.length === 0 ? (
        <EmptyState title="No sms messages" description="Inbound and outbound sms appears here." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Dir</TableHead><TableHead>Contact</TableHead><TableHead>Message</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {msgs.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-muted-foreground">{new Date(m.created_at).toLocaleString('en-US')}</TableCell>
                  <TableCell><Badge variant="outline">{m.direction}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{m.recipient ?? '—'}</TableCell>
                  <TableCell className="max-w-md truncate">{m.body ?? '—'}</TableCell>
                  <TableCell><Badge variant={m.delivery_status === 'blocked' ? 'blocked' : m.delivery_status === 'sent' || m.delivery_status === 'delivered' ? 'won' : 'pending'}>{m.delivery_status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
