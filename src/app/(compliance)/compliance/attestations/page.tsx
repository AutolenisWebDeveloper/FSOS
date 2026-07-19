import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { AttestationForm, AttestationAck } from '@/components/compliance/ComplianceControls'
import { Numeric, MonoLabel } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

type AttestationRow = {
  id: string
  title: string
  period: string | null
  status: string
  due_at: string | null
  created_at: string
}

// A2 ListShell — Attestations. Open attestations can be acknowledged by the
// signed-in reviewer (one response per user).
export default async function AttestationsPage() {
  const rows = await load<AttestationRow[]>(
    (db) => db.from('attestations').select('id, title, period, status, due_at, created_at').order('created_at', { ascending: false }).limit(200),
    [],
  )

  return (
    <ListShell
      title="Attestations"
      description="Periodic compliance attestations. Each open attestation records one acknowledgement per reviewer."
      breadcrumb={[{ label: 'Compliance', href: '/compliance' }, { label: 'Attestations' }]}
    >
      {!rows.ok ? (
        <ErrorState description={rows.kind === 'not_configured' ? 'Database not configured.' : rows.message} />
      ) : (
        <div className="space-y-6">
          {rows.data.length === 0 ? (
            <EmptyState title="No attestations" description="Open an attestation below for reviewers to acknowledge." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.data.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.title}</TableCell>
                      <TableCell className="text-muted-foreground">{a.period ?? '—'}</TableCell>
                      <TableCell><Badge variant={a.status === 'closed' ? 'won' : a.status === 'open' ? 'pending' : 'draft'}>{a.status}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{a.due_at ? <Numeric>{new Date(a.due_at).toLocaleDateString('en-US')}</Numeric> : '—'}</TableCell>
                      <TableCell className="text-right">{a.status === 'open' ? <div className="flex justify-end"><AttestationAck id={a.id} /></div> : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="rounded-lg border p-4">
            <MonoLabel as="p" className="mb-3">Open an attestation</MonoLabel>
            <AttestationForm />
          </div>
        </div>
      )}
    </ListShell>
  )
}
