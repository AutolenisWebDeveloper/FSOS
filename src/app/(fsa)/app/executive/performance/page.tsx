import { ReportShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import Link from 'next/link'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// Executive Performance (A11). Top agencies by attributed commission (v_commission_by_agency).
export default async function PerformancePage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await load<any[]>((db) => db.from('v_commission_by_agency').select('*').order('total_commission', { ascending: false }).limit(100), [])
  return (
    <ReportShell title="Performance" description="Attributed production by agency.">
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No performance data" description="Attributed commissions appear here after placements." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Agency</TableHead><TableHead>Family</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">FSA</TableHead><TableHead className="text-right">Received</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.referring_agency_id ? <Link href={`/app/agencies/${r.referring_agency_id}`} className="text-primary hover:underline">{r.agency_name ?? 'Agency'}</Link> : 'Direct'}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{r.product_family ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.total_commission).toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.fsa_amount).toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(r.received_amount).toLocaleString('en-US')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
