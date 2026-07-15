import Link from 'next/link'
import { ListShell, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface WorkflowRow {
  id: string
  name: string
  trigger_type: string
  enabled: boolean
  archived_at: string | null
  created_at: string
}

// P-2 Super — platform view of automation workflows. Read-only here; authoring
// lives in the FSA workflow builder.
export default async function SuperWorkflowsPage() {
  const rows = await load<WorkflowRow[]>(
    (db) =>
      db
        .from('automation_workflows')
        .select('id, name, trigger_type, enabled, archived_at, created_at')
        .order('created_at', { ascending: false }),
    [],
  )

  return (
    <ListShell
      title="Workflows"
      description="Platform view of automation workflows. Read-only here — authoring happens in the FSA workflow builder."
      breadcrumb={[{ label: 'Super', href: '/super' }, { label: 'Workflows' }]}
      actions={
        <Button asChild size="sm" variant="outline">
          <Link href="/app/workflows/builder">Open workflow builder</Link>
        </Button>
      }
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : rows.data.length === 0 ? (
        <EmptyState
          title="No workflows yet"
          description="Automation workflows authored in the FSA workflow builder appear here."
          action={
            <Button asChild size="sm">
              <Link href="/app/workflows/builder">Open workflow builder</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.trigger_type}</TableCell>
                  <TableCell className="space-x-2">
                    <StatusBadge status={r.enabled ? 'won' : 'draft'} label={r.enabled ? 'enabled' : 'disabled'} />
                    {r.archived_at ? <Badge variant="outline">archived</Badge> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('en-US')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
