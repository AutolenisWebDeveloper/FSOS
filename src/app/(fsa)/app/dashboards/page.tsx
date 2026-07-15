import Link from 'next/link'
import { Plus, LayoutDashboard } from 'lucide-react'
import { ListShell, ErrorState, EmptyState, StatusBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface DashboardRow {
  id: string
  name: string
  description: string | null
  layout: string[] | null
  visibility: string
  created_at: string
}

// OS-01 Custom dashboards directory (A2). Each dashboard is a saved, ordered set
// of DB-derived widgets — no drift from the data.
export default async function DashboardsPage() {
  const res = await load<DashboardRow[]>(
    (db) => db.from('dashboards').select('id, name, description, layout, visibility, created_at').is('archived_at', null).order('created_at', { ascending: false }),
    [],
  )

  const actions = (
    <Button asChild>
      <Link href="/app/dashboards/builder"><Plus className="h-4 w-4" /> New dashboard</Link>
    </Button>
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = res.kind === 'not_configured'
      ? <EmptyState icon={LayoutDashboard} title="Database not configured" description="Set Supabase env vars to load dashboards." />
      : <ErrorState description={res.message} />
  } else if (res.data.length === 0) {
    body = (
      <EmptyState
        icon={LayoutDashboard}
        title="No custom dashboards yet"
        description="Build a dashboard from the widget catalog — every widget renders live from your data."
        action={<Button asChild><Link href="/app/dashboards/builder"><Plus className="h-4 w-4" /> New dashboard</Link></Button>}
      />
    )
  } else {
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Widgets</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <Link href={`/app/dashboards/${d.id}`} className="hover:underline">{d.name}</Link>
                  {d.description ? <p className="text-xs font-normal text-muted-foreground">{d.description}</p> : null}
                </TableCell>
                <TableCell>{Array.isArray(d.layout) ? d.layout.length : 0}</TableCell>
                <TableCell>
                  {d.visibility === 'shared'
                    ? <StatusBadge status="active" label="shared" />
                    : <StatusBadge status="draft" label="private" />}
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString('en-US')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  const toolbar = (
    <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
      Dashboards are internal read surfaces. Every widget is derived from your live data — building one never changes what a report or the executive dashboard shows.
    </p>
  )

  return (
    <ListShell
      title="Dashboards"
      description="Custom dashboards assembled from the widget catalog."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Dashboards' }]}
      actions={actions}
      toolbar={toolbar}
    >
      {body}
    </ListShell>
  )
}
