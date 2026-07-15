import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-10 Service Requests (A2). Post-issue policy-service items.
export default async function ServiceRequestsPage() {
  const rows = await load<{ id: string; case_id: string; kind: string; detail: string | null; status: string; created_at: string }[]>(
    (db) => db.from('case_service_requests').select('*').order('created_at', { ascending: false }).limit(300),
    [],
  )

  return (
    <ListShell title="Service Requests" description="Post-issue policy-service items across cases." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases', href: '/app/cases' }, { label: 'Service requests' }]}>
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No service requests" description="Post-issue service items will appear here." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>Detail</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Case</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium capitalize">{r.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{r.detail ?? '—'}</TableCell>
                  <TableCell><Badge variant={r.status === 'resolved' ? 'won' : 'active'}>{r.status.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-right"><Link href={`/app/cases/${r.case_id}`} className="text-primary hover:underline">Open case</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
