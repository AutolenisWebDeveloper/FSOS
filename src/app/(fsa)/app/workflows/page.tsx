import Link from 'next/link'
import { Plus, Workflow } from 'lucide-react'
import { ListShell, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { REFERENCE_COPY_LABEL } from '@/lib/ops/automation-registry'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface WorkflowRow {
  id: string
  name: string
  trigger_type: string
  steps: unknown[] | null
  enabled: boolean
  created_at: string
}

// OS-14 Automation Workflows (A2 ListShell).
export default async function WorkflowsPage() {
  const res = await load<WorkflowRow[]>(
    (db) => db.from('automation_workflows').select('id, name, trigger_type, steps, enabled, created_at').is('archived_at', null).order('created_at', { ascending: false }),
    [],
  )

  const actions = (
    <Button asChild>
      <Link href="/app/workflows/builder"><Plus className="h-4 w-4" /> New workflow</Link>
    </Button>
  )

  const note = (
    <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      <span className="mr-2 align-middle"><Badge variant="draft">{REFERENCE_COPY_LABEL}</Badge></span>
      Workflows are saved designs only. No engine executes them yet, so nothing here runs, creates tasks or contacts
      anyone, and they cannot be enabled.
    </p>
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = res.kind === 'not_configured'
      ? <EmptyState icon={Workflow} title="Database not configured" description="Set Supabase env vars to load workflows." />
      : <ErrorState description={res.message} />
  } else if (res.data.length === 0) {
    body = (
      <EmptyState
        icon={Workflow}
        title="No workflows yet"
        description="Sketch a workflow design. Designs are saved for reference; nothing executes them yet."
        action={<Button asChild><Link href="/app/workflows/builder"><Plus className="h-4 w-4" /> New workflow</Link></Button>}
      />
    )
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Trigger</TableHead>
            <TableHead>Steps</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.data.map((w) => (
            <TableRow key={w.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/app/workflows/${w.id}`} className="hover:underline">{w.name}</Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{w.trigger_type.replace(/_/g, ' ')}</TableCell>
              <TableCell>{Array.isArray(w.steps) ? w.steps.length : 0}</TableCell>
              <TableCell>
                {w.enabled ? <StatusBadge status="pending" label="enabled · not executed" /> : <StatusBadge status="draft" label="design" />}
              </TableCell>
              <TableCell className="text-muted-foreground"><Numeric>{new Date(w.created_at).toLocaleDateString('en-US')}</Numeric></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <ListShell
      title="Workflows"
      description="Saved workflow designs. Not executed — there is no workflow engine yet."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Workflows' }]}
      actions={actions}
      toolbar={note}
    >
      {body}
    </ListShell>
  )
}
