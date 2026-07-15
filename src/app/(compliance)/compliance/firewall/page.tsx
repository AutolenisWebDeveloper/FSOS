import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
export const dynamic = 'force-dynamic'
// P-3 Securities Firewall. Demonstrates the firewall works — no securities substance shown.
export default async function ComplianceFirewallPage() {
  const events = await load<{ id: string; entity_type: string | null; blocked_step: string | null; reason: string | null; created_at: string }[]>(
    (db) => db.from('compliance_events').select('id, entity_type, blocked_step, reason, created_at').eq('kind', 'firewall').order('created_at', { ascending: false }).limit(300),
    [],
  )
  return (
    <ListShell title="Securities Firewall" description="Every securities auto-send attempt appears here as blocked + routed to FFS. Zero securities auto-sends succeed." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Firewall' }]}>
      {!events.ok ? <ErrorState description={events.kind === 'not_configured' ? 'Database not configured.' : events.message} /> : events.data.length === 0 ? <EmptyState title="No firewall events" description="No securities records have been excluded yet — the firewall is armed." /> : (
        <div className="rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Entity</TableHead><TableHead>Blocked step</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
          <TableBody>{events.data.map((e) => (<TableRow key={e.id}><TableCell className="text-muted-foreground">{new Date(e.created_at).toLocaleString('en-US')}</TableCell><TableCell>{e.entity_type ?? '—'}</TableCell><TableCell><Badge variant="blocked">{e.blocked_step ?? 'securities'}</Badge></TableCell><TableCell className="text-muted-foreground">{e.reason ?? '—'}</TableCell></TableRow>))}</TableBody>
        </Table></div>
      )}
    </ListShell>
  )
}
