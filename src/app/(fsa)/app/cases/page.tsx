import Link from 'next/link'
import { LayoutGrid, ClipboardList } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-10 Case Directory (A2). NIGO-free.
export default async function CasesPage() {
  const [cases, households] = await Promise.all([
    load<{ id: string; household_id: string | null; status: string; is_security: boolean; submitted_at: string | null }[]>(
      (db) => db.from('cases').select('id, household_id, status, is_security, submitted_at').is('archived_at', null).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])
  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))

  return (
    <ListShell
      title="Cases"
      description="Applications from submission through issue and service. No NIGO."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Cases' }]}
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/app/cases/requirements"><ClipboardList className="h-4 w-4" /> Requirements</Link></Button>
          <Button asChild variant="outline"><Link href="/app/cases/board"><LayoutGrid className="h-4 w-4" /> Board</Link></Button>
          <Button asChild><Link href="/app/cases/new">Open a case</Link></Button>
        </div>
      }
    >
      {!cases.ok ? (
        <ErrorState description={cases.kind === 'not_configured' ? 'Database not configured.' : cases.message} />
      ) : cases.data.length === 0 ? (
        <EmptyState title="No cases yet" description="Open a case from an opportunity that reached application." action={<Button asChild><Link href="/app/cases/new">Open a case</Link></Button>} />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Household</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
            <TableBody>
              {cases.data.map((c) => (
                <TableRow key={c.id} className={c.is_security ? securitiesRowClass : undefined}>
                  <TableCell><Link href={`/app/cases/${c.id}`} className="font-medium text-primary hover:underline">{c.household_id ? hhMap.get(c.household_id) ?? 'Case' : 'Case'}</Link>{c.is_security ? <SecuritiesChip className="ml-2" /> : null}</TableCell>
                  <TableCell><Badge variant={c.status === 'issued' || c.status === 'in_service' ? 'won' : c.status === 'declined' || c.status === 'withdrawn' ? 'lost' : 'active'}>{c.status.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-US') : '—'}</Numeric></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
