import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// WF-10 Incidents. A stateful workflow with the Reg S-P/Safeguards clock.
export default async function IncidentsPage() {
  const rows = await load<{ id: string; scope: string | null; data_types: string | null; status: string; affected_count: number | null; discovered_at: string }[]>(
    (db) => db.from('incidents').select('*').order('discovered_at', { ascending: false }).limit(200),
    [],
  )
  const daysLeft = (d: string) => Math.max(0, 30 - Math.floor((Date.now() - new Date(d).getTime()) / 86400000))

  return (
    <ListShell title="Incidents" description="Security incidents with the Reg S-P / Safeguards 30-day affected-notice clock." breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Incidents' }]}>
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No incidents" description="Open an incident to start the notification clock. Dates/thresholds are the configured compliance floor — counsel confirms specifics." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Discovered</TableHead><TableHead>Scope</TableHead><TableHead>Affected</TableHead><TableHead>Status</TableHead><TableHead>Clock</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-muted-foreground"><Numeric>{new Date(i.discovered_at).toLocaleDateString('en-US')}</Numeric></TableCell>
                  <TableCell className="font-medium">{i.scope ?? '—'}</TableCell>
                  <TableCell>{i.affected_count ?? '—'}</TableCell>
                  <TableCell><Badge variant={i.status === 'closed' ? 'won' : i.status === 'notifying' ? 'pending' : 'active'}>{i.status}</Badge></TableCell>
                  <TableCell>{i.status !== 'closed' ? <Badge variant={daysLeft(i.discovered_at) <= 5 ? 'lost' : 'outline'}>{daysLeft(i.discovered_at)}d to notice</Badge> : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
