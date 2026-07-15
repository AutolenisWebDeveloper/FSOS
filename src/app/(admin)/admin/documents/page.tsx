import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-2 Document processing. Classify/route uploaded docs. Verification never stores securities suitability.
export default async function AdminDocumentsPage() {
  const rows = await load<{ id: string; file_name: string | null; classification: string | null; scan_status: string; created_at: string }[]>(
    (db) => db.from('documents').select('id, file_name, classification, scan_status, created_at').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Document Processing" description="Classify and route uploaded documents." breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Documents' }]} actions={<Button asChild variant="outline"><Link href="/admin/documents/verify">Verify</Link></Button>}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No documents" description="Uploaded documents appear here for classification." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Classification</TableHead><TableHead>Scan</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((d) => (<TableRow key={d.id}><TableCell><Link href={`/app/documents/${d.id}`} className="font-medium text-primary hover:underline">{d.file_name ?? 'Document'}</Link></TableCell><TableCell className="text-muted-foreground">{d.classification ?? 'unclassified'}</TableCell><TableCell><Badge variant={d.scan_status === 'clean' ? 'won' : d.scan_status === 'infected' ? 'lost' : 'pending'}>{d.scan_status}</Badge></TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
