import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-2 Support Requests. Inbound public support tickets triaged.
export default async function SupportRequestsPage() {
  const rows = await load<{ id: string; name: string | null; subject: string | null; status: string; created_at: string }[]>(
    (db) => db.from('support_requests').select('id, name, subject, status, created_at').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Support Requests" description="Inbound support tickets." breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Support' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No support requests" description="Public support tickets appear here." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>From</TableHead><TableHead>Subject</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((r) => (<TableRow key={r.id}><TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-US')}</TableCell><TableCell>{r.name ?? '—'}</TableCell><TableCell className="text-muted-foreground">{r.subject ?? '—'}</TableCell><TableCell><Badge variant={r.status === 'resolved' ? 'won' : 'pending'}>{r.status}</Badge></TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
