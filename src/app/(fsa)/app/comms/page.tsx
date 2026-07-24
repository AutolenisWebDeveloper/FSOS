import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-12 Unified Communication Timeline (A2). Blocked messages appear WITH their
// reason (never hidden). There is no "force send" control.
export default async function CommsTimelinePage() {
  const msgs = await load<{ id: string; channel: string; direction: string; recipient: string | null; delivery_status: string; blocked_step: string | null; block_reason: string | null; consent_at_send: boolean | null; created_at: string }[]>(
    (db) => db.from('comm_messages').select('id, channel, direction, recipient, delivery_status, blocked_step, block_reason, consent_at_send, created_at').order('created_at', { ascending: false }).limit(300),
    [],
  )

  const nav = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><Link href="/app/comms/inbox">Inbox</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/sms">SMS</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/email">Email</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/templates">Templates</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/library">Library</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/campaigns">Campaigns</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/suppression">Suppression</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/assignments">Assignment Review</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/identity">Identity Disclosure</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/delivery">Delivery</Link></Button>
    </div>
  )

  return (
    <ListShell title="Communications" description="Every message with its consent + gate result at send time. Blocked is shown, never hidden." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms' }]} actions={nav}>
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
    </ListShell>
  )
}
