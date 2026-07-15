import Link from 'next/link'
import { ReportShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-08 Agency-Book Penetration Analysis (A11). The FSA growth thesis: big P&C book,
// low life penetration → highest-priority partner targets. Matches v_crosssell_targets.
export default async function AgencyPenetrationPage() {
  const rows = await load<{ id: string; agency_name: string; owner_name: string; pc_book_policies: number; life_policies_in_force: number; life_penetration_pct: number; target_score: number }[]>(
    (db) => db.from('v_crosssell_targets').select('*').order('target_score', { ascending: false }).limit(200),
    [],
  )

  return (
    <ReportShell title="Agency-Book Penetration" description="Large P&C book, low life penetration — the highest-value partner targets.">
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState title="No agencies" description="Add agency partnerships with book figures to rank penetration." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Agency</TableHead><TableHead className="text-right">P&C book</TableHead><TableHead className="text-right">Life in force</TableHead><TableHead className="text-right">Life penetration</TableHead><TableHead className="text-right">Target score</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/app/agencies/${r.id}`} className="font-medium text-primary hover:underline">{r.agency_name}</Link><span className="ml-2 text-xs text-muted-foreground">{r.owner_name}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{r.pc_book_policies.toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.life_policies_in_force.toLocaleString('en-US')}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.life_penetration_pct}%</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{Math.round(r.target_score).toLocaleString('en-US')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
