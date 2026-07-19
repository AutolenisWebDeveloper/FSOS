import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
export const dynamic = 'force-dynamic'
// P-3 Consent oversight. Per-member per-channel status + source + timestamp.
export default async function ComplianceConsentPage() {
  const rows = await load<{ id: string; channel: string; status: string; source: string | null; captured_at: string }[]>(
    (db) => db.from('consents').select('id, channel, status, source, captured_at').order('captured_at', { ascending: false }).limit(500),
    [],
  )
  return (
    <ListShell title="Consent" description="Per-channel consent is authoritative over all sends — re-checked at send time." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Consent' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No consent records" description="Consent captured at intake/portal appears here." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Source</TableHead><TableHead>Captured</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((c) => (<TableRow key={c.id}><TableCell><Badge variant="outline">{c.channel}</Badge></TableCell><TableCell><Badge variant={c.status === 'granted' ? 'won' : 'lost'}>{c.status}</Badge></TableCell><TableCell className="text-muted-foreground">{c.source ?? '—'}</TableCell><TableCell className="text-muted-foreground"><Numeric>{new Date(c.captured_at).toLocaleDateString('en-US')}</Numeric></TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
