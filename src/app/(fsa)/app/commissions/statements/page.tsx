import { ReportShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Money } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-11 Statements (A2). Period statements + export.
export default async function StatementsPage() {
  const rows = await load<{ id: string; product_family: string | null; total_commission: number; fsa_amount: number; received_amount: number; paid_on: string | null; period: string | null }[]>(
    (db) => db.from('commissions').select('id, product_family, total_commission, fsa_amount, received_amount, paid_on, period').order('paid_on', { ascending: false, nullsFirst: false }).limit(500),
    [],
  )
  const byPeriod = new Map<string, { total: number; fsa: number; received: number }>()
  if (rows.ok) for (const r of rows.data) {
    const p = r.period || (r.paid_on ? r.paid_on.slice(0, 7) : 'Unassigned')
    const cur = byPeriod.get(p) ?? { total: 0, fsa: 0, received: 0 }
    cur.total += Number(r.total_commission || 0); cur.fsa += Number(r.fsa_amount || 0); cur.received += Number(r.received_amount || 0)
    byPeriod.set(p, cur)
  }

  return (
    <ReportShell title="Commission Statements" description="Period statements. Export from the Reports library." actions={<AssumptionBadge />}>
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : byPeriod.size === 0 ? (
        <EmptyState title="No statements yet" description="Commission periods appear here once placements are recorded." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Period</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">FSA share</TableHead><TableHead className="text-right">Received</TableHead></TableRow></TableHeader>
            <TableBody>
              {Array.from(byPeriod.entries()).map(([p, v]) => (
                <TableRow key={p}>
                  <TableCell className="font-medium">{p}</TableCell>
                  <TableCell className="text-right"><Money value={v.total} /></TableCell>
                  <TableCell className="text-right"><Money value={v.fsa} /></TableCell>
                  <TableCell className="text-right"><Money value={v.received} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
