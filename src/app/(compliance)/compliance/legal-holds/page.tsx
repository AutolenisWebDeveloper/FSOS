import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { LegalHoldForm, LegalHoldControls } from '@/components/compliance/ComplianceControls'
import { Numeric, MonoLabel } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

type LegalHoldRow = {
  id: string
  name: string
  matter_ref: string | null
  reason: string | null
  scope: { entity_type?: string } | null
  status: string
  placed_at: string
}

// A2 ListShell — Legal Holds. A hold SUSPENDS deletion/retention for its scope:
// an override, never a delete. Releasing lifts preservation; it destroys nothing.
export default async function LegalHoldsPage() {
  const rows = await load<LegalHoldRow[]>(
    (db) => db.from('legal_holds').select('*').order('placed_at', { ascending: false }).limit(200),
    [],
  )

  return (
    <ListShell
      title="Legal Holds"
      description="A legal hold suspends deletion/retention for its scope — a preservation override. Releasing a hold lifts that override; it does not delete anything."
      breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Legal Holds' }]}
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : (
        <div className="space-y-6">
          {rows.data.length === 0 ? (
            <EmptyState title="No legal holds" description="Place a hold below to suspend retention-based deletion for a matter's scope." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Matter ref</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Placed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell className="text-muted-foreground">{h.matter_ref ? <Numeric>{h.matter_ref}</Numeric> : '—'}</TableCell>
                      <TableCell><Badge variant={h.status === 'active' ? 'pending' : 'draft'}>{h.status}</Badge></TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground" title={h.reason ?? undefined}>{h.reason ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground"><Numeric>{new Date(h.placed_at).toLocaleDateString('en-US')}</Numeric></TableCell>
                      <TableCell className="text-right">{h.status === 'active' ? <LegalHoldControls id={h.id} /> : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="rounded-lg border p-4">
            <MonoLabel as="p" className="mb-3">Place a legal hold</MonoLabel>
            <LegalHoldForm />
          </div>
        </div>
      )}
    </ListShell>
  )
}
