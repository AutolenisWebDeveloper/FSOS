import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-13 Document Requests (A2). Outstanding items the FSA/case needs.
export default async function DocumentRequestsPage() {
  const [reqs, households] = await Promise.all([
    load<{ id: string; household_id: string | null; case_id: string | null; requirement: string; status: string; created_at: string }[]>(
      (db) => db.from('document_requests').select('*').order('created_at', { ascending: false }).limit(300),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))

  return (
    <ListShell title="Document Requests" description="Outstanding items needed from clients and for cases." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Documents', href: '/app/documents' }, { label: 'Requests' }]}>
      {!reqs.ok ? (
        <ErrorState description={reqs.kind === 'not_configured' ? 'Database not configured.' : reqs.message} />
      ) : reqs.data.length === 0 ? (
        <EmptyState title="No document requests" description="Requests appear here when raised from a case or household." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Requirement</TableHead><TableHead>Household</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Case</TableHead></TableRow></TableHeader>
            <TableBody>
              {reqs.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.requirement}</TableCell>
                  <TableCell className="text-muted-foreground">{r.household_id ? hhMap.get(r.household_id) ?? '—' : '—'}</TableCell>
                  <TableCell><Badge variant={r.status === 'received' ? 'won' : r.status === 'waived' ? 'outline' : 'pending'}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">{r.case_id ? <Link href={`/app/cases/${r.case_id}`} className="text-primary hover:underline">Case</Link> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
