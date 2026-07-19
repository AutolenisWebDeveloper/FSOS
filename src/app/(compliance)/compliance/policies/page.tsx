import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { PolicyForm, PolicyControls } from '@/components/compliance/ComplianceControls'
import { Numeric, MonoLabel } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

type PolicyRow = {
  id: string
  title: string
  category: string | null
  version: number
  status: string
  updated_at: string
}

// A2 ListShell — Compliance Policies. Draft → published (effective) → retired.
export default async function PoliciesPage() {
  const rows = await load<PolicyRow[]>(
    (db) => db.from('compliance_policies').select('id, title, category, version, status, updated_at').order('updated_at', { ascending: false }).limit(200),
    [],
  )

  return (
    <ListShell
      title="Policies"
      description="Compliance policy library. Draft policies can be published to make them effective; published policies can be retired."
      breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Policies' }]}
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : (
        <div className="space-y-6">
          {rows.data.length === 0 ? (
            <EmptyState title="No policies" description="Draft a policy below, then publish it to make it effective." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.title}</TableCell>
                      <TableCell className="text-muted-foreground">{p.category ?? '—'}</TableCell>
                      <TableCell><Numeric>v{p.version}</Numeric></TableCell>
                      <TableCell><Badge variant={p.status === 'published' ? 'won' : p.status === 'retired' ? 'lost' : 'draft'}>{p.status}</Badge></TableCell>
                      <TableCell className="text-right"><div className="flex justify-end"><PolicyControls id={p.id} status={p.status} /></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="rounded-lg border p-4">
            <MonoLabel as="p" className="mb-3">New policy</MonoLabel>
            <PolicyForm />
          </div>
        </div>
      )}
    </ListShell>
  )
}
