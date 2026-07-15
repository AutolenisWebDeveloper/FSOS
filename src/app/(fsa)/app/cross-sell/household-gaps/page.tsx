import Link from 'next/link'
import { ReportShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-08 Household Coverage-Gap Analysis (A11). Basket is editable config.
export default async function HouseholdGapsPage() {
  const [gaps, basket] = await Promise.all([
    load<{ household_id: string; primary_name: string; families_held: string[] | null; next_best_line: string | null; gap_count: number; has_life: boolean }[]>(
      (db) => db.from('v_cross_sell_gaps').select('*').order('gap_count', { ascending: false }).limit(500),
      [],
    ),
    load<{ line: string; priority: number }[]>((db) => db.from('cross_sell_basket').select('line, priority').order('priority'), []),
  ])

  return (
    <ReportShell
      title="Household Coverage Gaps"
      description="Lines held vs the recommended basket. A gap is a review opportunity — not a product recommendation."
      actions={<AssumptionBadge />}
      filters={<p className="text-sm text-muted-foreground">Recommended basket (config, editable): {(basket.ok ? basket.data : []).map((b) => b.line).join(' → ') || '—'}</p>}
    >
      {!gaps.ok ? (
        <ErrorState description={gaps.kind === 'not_configured' ? 'Database not configured.' : gaps.message} />
      ) : gaps.data.length === 0 ? (
        <EmptyState title="No gaps" description="All households are multi-line or opted out." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Household</TableHead><TableHead>Held</TableHead><TableHead>Next gap</TableHead><TableHead className="text-right">Gaps</TableHead></TableRow></TableHeader>
            <TableBody>
              {gaps.data.map((g) => (
                <TableRow key={g.household_id}>
                  <TableCell><Link href={`/app/cross-sell/${g.household_id}`} className="font-medium text-primary hover:underline">{g.primary_name}</Link></TableCell>
                  <TableCell className="capitalize text-muted-foreground">{(g.families_held ?? []).join(', ') || 'none'}</TableCell>
                  <TableCell className="capitalize">{g.next_best_line ?? '—'}{!g.has_life ? <Badge variant="pending" className="ml-2">no life</Badge> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.gap_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportShell>
  )
}
