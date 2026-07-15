import Link from 'next/link'
import { ListShell, ErrorState, EmptyState, AssumptionBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'

export const dynamic = 'force-dynamic'

// OS-07 Eligible / Monitoring (A2). Own-book term policies with a configured window.
export default async function ConversionsEligiblePage({ searchParams }: { searchParams: { tier?: string } }) {
  const rows = await load<{ policy_id: string; household_id: string; primary_name: string; policy_number: string | null; conversion_deadline: string; days_remaining: number; urgency_tier: string; is_security: boolean }[]>(
    (db) => db.from('v_conversions_due').select('*').neq('urgency_tier', 'beyond').order('days_remaining', { ascending: true }).limit(500),
    [],
  )
  const tierFilter = searchParams.tier
  const order = ['30', '90', '180', '365']
  const filtered = rows.ok && tierFilter ? rows.data.filter((r) => order.indexOf(r.urgency_tier) <= order.indexOf(tierFilter)) : rows.ok ? rows.data : []

  return (
    <ListShell
      title="Eligible Conversions"
      description="Own-book term policies approaching their conversion window."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Term Conversion', href: '/app/conversions' }, { label: 'Eligible' }]}
      actions={<span className="flex items-center gap-2"><AssumptionBadge /></span>}
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No eligible policies" description="No policies with a configured conversion window in this tier. Window source is a config default — verify." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Household</TableHead><TableHead>Policy</TableHead><TableHead>Deadline</TableHead><TableHead>Urgency</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.policy_id} className={r.is_security ? securitiesRowClass : undefined}>
                  <TableCell>
                    <Link href={`/app/conversions/${r.policy_id}`} className="font-medium text-primary hover:underline">{r.primary_name}</Link>
                    {r.is_security ? <SecuritiesChip className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{r.policy_number ?? '—'}</Numeric></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{r.conversion_deadline}</Numeric> · <Numeric>{r.days_remaining}d</Numeric></TableCell>
                  <TableCell><Badge variant={r.urgency_tier === '30' ? 'lost' : r.urgency_tier === '90' ? 'pending' : 'outline'}>≤{r.urgency_tier}d</Badge></TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/conversions/${r.policy_id}`}>Open</Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
