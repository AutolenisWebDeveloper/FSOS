import Link from 'next/link'
import { FileCheck2 } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// P2 Missing documents (A2 ListShell). Outstanding case requirements + document
// requests with no linked document.
interface MissingRow {
  source: string | null
  source_id: string
  case_id: string | null
  household_id: string | null
  requirement: string | null
  status: string | null
  created_at: string | null
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Documents', href: '/app/documents' },
  { label: 'Missing' },
]

const ageDays = (iso: string | null): number | null => {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

export default async function MissingDocumentsPage() {
  const res = await load<MissingRow[]>(
    (db) =>
      db
        .from('v_missing_documents')
        .select('source, source_id, case_id, household_id, requirement, status, created_at')
        .order('created_at', { ascending: true, nullsFirst: false }),
    [],
  )

  if (!res.ok) {
    return (
      <ListShell title="Missing Documents" breadcrumb={breadcrumb}>
        <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
      </ListShell>
    )
  }

  const rows = res.data
  const description = 'Outstanding case requirements and document requests with no linked document.'

  if (rows.length === 0) {
    return (
      <ListShell title="Missing Documents" description={description} breadcrumb={breadcrumb}>
        <EmptyState icon={FileCheck2} title="No missing documents — everything's in good order." />
      </ListShell>
    )
  }

  return (
    <ListShell title="Missing Documents" description={description} breadcrumb={breadcrumb}>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requirement</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Household</TableHead>
              <TableHead>Case</TableHead>
              <TableHead className="text-right">Age (days)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.source}-${r.source_id}`}>
                <TableCell className="font-medium">{r.requirement ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={r.source === 'case_requirement' ? 'pending' : 'draft'}>
                    {(r.source ?? 'unknown').replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.household_id ? (
                    <Link href={`/app/households/${r.household_id}`} className="text-primary hover:underline">
                      View household
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {r.case_id ? (
                    <Link href={`/app/cases/${r.case_id}`} className="text-primary hover:underline">
                      View case
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{ageDays(r.created_at) ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ListShell>
  )
}
