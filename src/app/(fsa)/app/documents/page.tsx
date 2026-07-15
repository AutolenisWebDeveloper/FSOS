import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-13 Document Library (A2). Virus-scanned, signed-URL storage, classified.
export default async function DocumentsPage() {
  const docs = await load<{ id: string; file_name: string | null; classification: string | null; entity_type: string | null; scan_status: string; retention_until: string | null; legal_hold: boolean; created_at: string }[]>(
    (db) => db.from('documents').select('id, file_name, classification, entity_type, scan_status, retention_until, legal_hold, created_at').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Documents" description="Virus-scanned, signed-URL storage. Retention ≥ 7 years; legal-hold prevents premature deletion." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Documents' }]} actions={<Button asChild variant="outline"><Link href="/app/documents/requests">Requests</Link></Button>}>
      {!docs.ok ? (
        <ErrorState description={docs.kind === 'not_configured' ? 'Database not configured.' : docs.message} />
      ) : docs.data.length === 0 ? (
        <EmptyState title="No documents yet" description="Uploaded documents are virus-scanned and classified to a household or case." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Classification</TableHead><TableHead>Scan</TableHead><TableHead>Retention</TableHead></TableRow></TableHeader>
            <TableBody>
              {docs.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><Link href={`/app/documents/${d.id}`} className="font-medium text-primary hover:underline">{d.file_name ?? 'Document'}</Link>{d.legal_hold ? <Badge variant="blocked" className="ml-2">legal hold</Badge> : null}</TableCell>
                  <TableCell className="text-muted-foreground">{d.classification ?? d.entity_type ?? '—'}</TableCell>
                  <TableCell><Badge variant={d.scan_status === 'clean' ? 'won' : d.scan_status === 'infected' ? 'lost' : 'pending'}>{d.scan_status}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{d.retention_until ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
