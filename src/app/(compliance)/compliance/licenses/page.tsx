import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
export const dynamic = 'force-dynamic'
// P-3 Licenses. State life/health + securities registrations with status + expiry.
export default async function ComplianceLicensesPage() {
  const rows = await load<{ id: string; kind: string | null; state: string | null; status: string; expires_on: string | null }[]>(
    (db) => db.from('licenses').select('*').order('expires_on', { ascending: true, nullsFirst: false }),
    [],
  )
  const soon = (d: string | null) => d && new Date(d).getTime() - Date.now() < 60 * 86400000
  return (
    <ListShell title="Licenses & Registrations" description="A license lapse disables the dependent product path until renewed." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Licenses' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No licenses on file" description="Add license/registration records to gate product eligibility." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>State</TableHead><TableHead>Status</TableHead><TableHead>Expires</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((l) => (<TableRow key={l.id}><TableCell className="font-medium">{l.kind ?? '—'}</TableCell><TableCell className="text-muted-foreground">{l.state ?? '—'}</TableCell><TableCell><Badge variant={l.status === 'active' ? 'won' : l.status === 'expired' ? 'lost' : 'pending'}>{l.status}</Badge></TableCell><TableCell>{l.expires_on ? <Numeric>{l.expires_on}</Numeric> : '—'}{soon(l.expires_on) ? <Badge variant="pending" className="ml-2">expiring</Badge> : null}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
