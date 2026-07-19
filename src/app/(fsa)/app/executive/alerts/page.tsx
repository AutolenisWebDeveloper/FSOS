import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Numeric } from '@/components/ui/typography'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// Executive Alerts (A2). Compliance events + escalations needing attention.
export default async function AlertsPage() {
  const events = await load<{ id: string; kind: string; reason: string | null; entity_type: string | null; blocked_step: string | null; created_at: string }[]>(
    (db) => db.from('compliance_events').select('id, kind, reason, entity_type, blocked_step, created_at').order('created_at', { ascending: false }).limit(200),
    [],
  )
  return (
    <ListShell title="Alerts" description="Compliance events, firewall blocks, and escalations." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Executive' }, { label: 'Alerts' }]}>
      {!events.ok ? (
        <ErrorState description={events.kind === 'not_configured' ? 'Database not configured.' : events.message} />
      ) : events.data.length === 0 ? (
        <EmptyState title="No alerts" description="Compliance events and escalations appear here." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Kind</TableHead><TableHead>Entity</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
            <TableBody>
              {events.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><Numeric className="text-muted-foreground">{new Date(e.created_at).toLocaleString('en-US')}</Numeric></TableCell>
                  <TableCell><Badge variant={e.kind === 'firewall' ? 'blocked' : e.kind === 'comms_blocked' ? 'lost' : 'pending'}>{e.kind.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{e.entity_type ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{e.reason ?? e.blocked_step ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
