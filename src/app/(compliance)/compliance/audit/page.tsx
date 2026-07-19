import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
export const dynamic = 'force-dynamic'
// P-3 Audit. The append-only audit log (compliance/supervisor/super may read).
export default async function ComplianceAuditPage() {
  const rows = await load<{ id: number; actor: string; action: string; entity: string; entity_id: string | null; at: string }[]>(
    (db) => db.from('audit_log').select('id, actor, action, entity, entity_id, at').order('at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Audit Log" description="Append-only, tamper-evident. Every mutation, send, block, and AI action." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Audit' }]}>
      {!rows.ok ? <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} /> : rows.data.length === 0 ? <EmptyState title="No audit entries" description="Audited actions appear here." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead></TableRow></TableHeader>
          <TableBody>{rows.data.map((r) => (<TableRow key={r.id}><TableCell className="text-muted-foreground"><Numeric>{new Date(r.at).toLocaleString('en-US')}</Numeric></TableCell><TableCell className="text-muted-foreground">{r.actor}</TableCell><TableCell><Badge variant="outline">{r.action}</Badge></TableCell><TableCell className="text-muted-foreground">{r.entity}{r.entity_id ? <> · <Numeric>{r.entity_id.slice(0, 8)}</Numeric></> : ''}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
