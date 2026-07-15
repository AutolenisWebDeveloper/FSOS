import { ReportShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// Executive Production (A11). Placements + premium by engagement/stage (v_pipeline_by_engagement).
export default async function ProductionPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await load<any[]>((db) => db.from('v_pipeline_by_engagement').select('*'), [])
  return (
    <ReportShell title="Production" description="Pipeline by engagement model and stage.">
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No production yet" description="Opportunities appear here as they move through the pipeline." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Engagement</TableHead><TableHead>Stage</TableHead><TableHead className="text-right">Opps</TableHead><TableHead className="text-right">Premium</TableHead><TableHead className="text-right">Expected commission</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="capitalize">{String(r.engagement).replace(/_/g, ' ')}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{String(r.stage).replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.opp_count).toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.total_premium).toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.expected_commission).toLocaleString('en-US')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
