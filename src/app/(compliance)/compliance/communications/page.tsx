import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
export const dynamic = 'force-dynamic'
// P-3 Communications oversight. Blocked messages appear with reason; supervisory read-only.
export default async function ComplianceCommsPage() {
  const msgs = await load<{ id: string; channel: string; recipient: string | null; delivery_status: string; blocked_step: string | null; created_at: string }[]>(
    (db) => db.from('comm_messages').select('id, channel, recipient, delivery_status, blocked_step, created_at').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Communications" description="Supervisory view of every message and its gate result." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Communications' }]}>
      {!msgs.ok ? <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} /> : msgs.data.length === 0 ? <EmptyState title="No messages" description="Messages and their gate results appear here." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Channel</TableHead><TableHead>Recipient</TableHead><TableHead>Status</TableHead><TableHead>Gate</TableHead></TableRow></TableHeader>
          <TableBody>{msgs.data.map((m) => (<TableRow key={m.id}><TableCell className="text-muted-foreground"><Numeric>{new Date(m.created_at).toLocaleString('en-US')}</Numeric></TableCell><TableCell><Badge variant="outline">{m.channel}</Badge></TableCell><TableCell className="text-muted-foreground">{m.recipient ?? '—'}</TableCell><TableCell><Badge variant={m.delivery_status === 'blocked' ? 'blocked' : m.delivery_status === 'sent' ? 'won' : 'pending'}>{m.delivery_status}</Badge></TableCell><TableCell className="text-xs text-muted-foreground">{m.blocked_step ?? '—'}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
