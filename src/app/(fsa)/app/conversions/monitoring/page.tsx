import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-07 Monitoring (A2). Enrolled/responding conversion opportunities via activity log.
export default async function ConversionMonitoringPage() {
  const activities = await load<{ id: string; entity_id: string; kind: string | null; note: string | null; created_at: string }[]>(
    (db) => db.from('activities').select('id, entity_id, kind, note, created_at').eq('entity_type', 'policy').like('kind', 'conversion_%').order('created_at', { ascending: false }).limit(200),
    [],
  )

  return (
    <ListShell
      title="Conversion Monitoring"
      description="Educational outreach activity across eligible policies."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Term Conversion', href: '/app/conversions' }, { label: 'Monitoring' }]}
    >
      {!activities.ok ? (
        <ErrorState description={activities.kind === 'not_configured' ? 'Database not configured.' : activities.message} />
      ) : activities.data.length === 0 ? (
        <EmptyState title="No outreach yet" description="Green-zone conversion outreach appears here once logged." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Note</TableHead><TableHead className="text-right">Policy</TableHead></TableRow></TableHeader>
            <TableBody>
              {activities.data.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground">{new Date(a.created_at).toLocaleString('en-US')}</TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{(a.kind ?? '').replace('conversion_', '').replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">{a.note}</TableCell>
                  <TableCell className="text-right"><Link href={`/app/conversions/${a.entity_id}`} className="text-primary hover:underline">Open</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
