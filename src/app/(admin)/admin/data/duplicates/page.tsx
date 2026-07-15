import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

type DuplicateRow = {
  match_key: string
  dup_count: number
  household_ids: string[]
}

// P-2 Admin Duplicate Detection (A2 ListShell). Read-only detection view — merge
// is a deliberate manual admin action, never automated.
export default async function DuplicateHouseholdsPage() {
  const dups = await load<DuplicateRow[]>(
    (db) => db
      .from('v_duplicate_households')
      .select('match_key, dup_count, household_ids')
      .order('dup_count', { ascending: false }),
    [],
  )

  return (
    <ListShell
      title="Duplicate Households"
      description="Potential duplicate households detected by normalized primary name."
      breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'Data' }, { label: 'Duplicates' }]}
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          These are potential duplicates grouped by normalized primary name. Review each group before merging — merging
          households is a manual admin action and is never performed automatically.
        </p>

        {!dups.ok ? (
          <ErrorState description={dups.kind === 'not_configured' ? 'Database not configured.' : dups.message} />
        ) : dups.data.length === 0 ? (
          <EmptyState title="No duplicates" description="No duplicate households detected." />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Matched name</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Households</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dups.data.map((d) => (
                  <TableRow key={d.match_key}>
                    <TableCell className="font-medium">{d.match_key}</TableCell>
                    <TableCell>{d.dup_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {d.household_ids.map((id) => (
                          <Link key={id} href={`/app/households/${id}`} className="text-sm text-primary underline underline-offset-2">
                            <Numeric>{id.slice(0, 8)}</Numeric>
                          </Link>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </ListShell>
  )
}
