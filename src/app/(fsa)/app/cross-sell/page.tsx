import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-08 Cross-Sell Opportunity List (A2). Output is framed as a coverage GAP /
// review opportunity — never a "recommended product."
export default async function CrossSellPage() {
  const gaps = await load<{ household_id: string; primary_name: string; next_best_line: string | null; gap_count: number; has_life: boolean; score: number }[]>(
    (db) => db.from('v_cross_sell_gaps').select('*').order('score', { ascending: false }).limit(500),
    [],
  )

  const actions = (
    <div className="flex gap-2">
      <Button asChild variant="outline"><Link href="/app/cross-sell/household-gaps">Household gaps</Link></Button>
      <Button asChild variant="outline"><Link href="/app/cross-sell/agency-penetration">Agency penetration</Link></Button>
      <Button asChild variant="outline"><Link href="/app/cross-sell/analytics">Analytics</Link></Button>
    </div>
  )

  return (
    <ListShell
      title="Cross-Sell"
      description="Coverage gaps and review opportunities. We identify and invite — never recommend a product."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cross-Sell' }]}
      actions={actions}
    >
      {!gaps.ok ? (
        <ErrorState description={gaps.kind === 'not_configured' ? 'Database not configured.' : gaps.message} />
      ) : gaps.data.length === 0 ? (
        <EmptyState title="No gaps identified" description="Households are multi-line or have opted out. Adjust the recommended basket config to change gap logic." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Household</TableHead><TableHead>Next coverage gap</TableHead><TableHead>Gaps</TableHead><TableHead>Score</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {gaps.data.map((g) => (
                <TableRow key={g.household_id}>
                  <TableCell><Link href={`/app/cross-sell/${g.household_id}`} className="font-medium text-primary hover:underline">{g.primary_name}</Link>{!g.has_life ? <Badge variant="pending" className="ml-2">no life</Badge> : null}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{g.next_best_line ?? '—'} <span className="text-xs">(gap, not a recommendation)</span></TableCell>
                  <TableCell>{g.gap_count}</TableCell>
                  <TableCell className="tabular-nums">{g.score}</TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/cross-sell/${g.household_id}`}>Open</Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
