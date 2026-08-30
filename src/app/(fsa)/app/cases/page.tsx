import Link from 'next/link'
import { LayoutGrid, ClipboardList, Briefcase, Workflow, CheckCircle2, ShieldAlert } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { PageStatStrip, type PageStat } from '@/components/app/PageStatStrip'
import { CaseList } from '@/components/app/CaseList'

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

  // Summary — computed from the cases already loaded (no new query). NIGO-free;
  // the securities tile surfaces the firewall count with the purple marker.
  const caseRows = cases.ok ? cases.data : []
  const issued = caseRows.filter((c) => c.status === 'issued' || c.status === 'in_service').length
  const closed = caseRows.filter((c) => c.status === 'declined' || c.status === 'withdrawn').length
  const active = caseRows.length - issued - closed
  const securities = caseRows.filter((c) => c.is_security).length
  const stats: PageStat[] = [
    { label: 'Cases', value: caseRows.length, hint: 'Open in your book', icon: Briefcase, accent: 'brand' },
    { label: 'In progress', value: active, hint: 'Working requirements', href: '/app/cases/board', icon: Workflow, accent: 'neutral' },
    { label: 'Issued', value: issued, hint: 'Placed & in service', icon: CheckCircle2, accent: 'positive' },
    { label: 'Securities-flagged', value: securities, hint: 'FFS-managed', icon: ShieldAlert, accent: 'security' },
  ]

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
        <div className="space-y-6">
          <PageStatStrip stats={stats} />
          <CaseList
            rows={cases.data.map((c) => ({
              id: c.id,
              household_name: c.household_id ? hhMap.get(c.household_id) ?? 'Case' : 'Case',
              status: c.status,
              is_security: c.is_security,
              submitted_at: c.submitted_at,
            }))}
          />
        </div>
      )}
    </ListShell>
  )
}
