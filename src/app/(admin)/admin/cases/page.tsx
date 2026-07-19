import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-2 Cases queue. Operational processing view. Securities cases stay pointer-only.
export default async function AdminCasesPage() {
  const rows = await load<{ id: string; status: string; is_security: boolean; submitted_at: string | null }[]>(
    (db) => db.from('cases').select('id, status, is_security, submitted_at').is('archived_at', null).order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Cases Queue" description="Operational case processing. Securities cases remain pointer-only." breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Cases' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No cases" description="Cases appear here as they are opened." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>Case</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((c) => (<TableRow key={c.id} className={c.is_security ? securitiesRowClass : undefined}><TableCell><Link href={`/app/cases/${c.id}`} className="font-medium text-primary hover:underline"><Numeric>{c.id.slice(0, 8)}</Numeric></Link>{c.is_security ? <SecuritiesChip className="ml-2" /> : null}</TableCell><TableCell><Badge variant={c.status === 'issued' ? 'won' : 'active'}>{c.status.replace(/_/g, ' ')}</Badge></TableCell><TableCell className="text-muted-foreground"><Numeric>{c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-US') : '—'}</Numeric></TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
