import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-06 Reviews Due (A2). Term-conversion windows + annual anniversaries approaching.
export default async function ReviewsDuePage() {
  const conversions = await load<{ policy_id: string; household_id: string; primary_name: string; conversion_deadline: string; days_remaining: number; urgency_tier: string; is_security: boolean }[]>(
    (db) => db.from('v_conversions_due').select('*').neq('urgency_tier', 'beyond').order('days_remaining', { ascending: true }).limit(200),
    [],
  )

  return (
    <ListShell
      title="Reviews Due"
      description="Approaching conversion windows and review anniversaries."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Reviews', href: '/app/reviews' }, { label: 'Due' }]}
      actions={<Button asChild variant="outline"><Link href="/app/reviews">All reviews</Link></Button>}
    >
      {!conversions.ok ? (
        <ErrorState description={conversions.kind === 'not_configured' ? 'Database not configured.' : conversions.message} />
      ) : conversions.data.length === 0 ? (
        <EmptyState title="Nothing due" description="No approaching conversion windows. Window source is a config default — verify." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Household</TableHead><TableHead>Deadline</TableHead><TableHead>Urgency</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {conversions.data.map((c) => (
                <TableRow key={c.policy_id}>
                  <TableCell>
                    <Link href={`/app/households/${c.household_id}`} className="font-medium text-primary hover:underline">{c.primary_name}</Link>
                    {c.is_security ? <Badge variant="blocked" className="ml-2">securities · excluded</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.conversion_deadline} · {c.days_remaining}d</TableCell>
                  <TableCell><Badge variant={c.urgency_tier === '30' ? 'lost' : c.urgency_tier === '90' ? 'pending' : 'outline'}>≤{c.urgency_tier}d</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline"><Link href={`/app/reviews/new?household=${c.household_id}&type=term_conversion`}>Schedule</Link></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
