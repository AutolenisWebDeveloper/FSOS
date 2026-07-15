import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-10 Requirements (A2). Outstanding items across all cases; each links to its case.
export default async function RequirementsPage() {
  const reqs = await load<{ id: string; case_id: string; requirement: string; status: string; source: string | null }[]>(
    (db) => db.from('case_requirements').select('id, case_id, requirement, status, source').eq('status', 'outstanding').order('created_at', { ascending: true }).limit(500),
    [],
  )

  return (
    <ListShell title="Outstanding Requirements" description="Every outstanding item across all cases is actionable." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases', href: '/app/cases' }, { label: 'Requirements' }]}>
      {!reqs.ok ? (
        <ErrorState description={reqs.kind === 'not_configured' ? 'Database not configured.' : reqs.message} />
      ) : reqs.data.length === 0 ? (
        <EmptyState title="No outstanding requirements" description="All case requirements are received or waived." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Requirement</TableHead><TableHead>Source</TableHead><TableHead className="text-right">Case</TableHead></TableRow></TableHeader>
            <TableBody>
              {reqs.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.requirement}</TableCell>
                  <TableCell><Badge variant="outline">{r.source ?? 'manual'}</Badge></TableCell>
                  <TableCell className="text-right"><Link href={`/app/cases/${r.case_id}/checklist`} className="text-primary hover:underline">Open case</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
