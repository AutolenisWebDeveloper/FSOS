import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { SequenceCreateForm } from '@/components/app/SequenceControls'

export const dynamic = 'force-dynamic'

type SequenceStep = { delay_days: number; template_id?: string; subject?: string }
type SequenceRow = {
  id: string
  name: string
  channel: string
  category: string | null
  steps: SequenceStep[] | null
  status: string
}

// OS-13 Comms — sequences (A2 ListShell). Sequences are green-zone education /
// invitation drips. They NEVER bypass the send gate.
export default async function SequencesPage() {
  const sequences = await load<SequenceRow[]>(
    (db) => db.from('comm_sequences').select('id, name, channel, category, steps, status').order('updated_at', { ascending: false }),
    [],
  )

  return (
    <ListShell
      title="Sequences"
      description="Multi-step education/invitation drips. requires_optout defaults on."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Sequences' }]}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm text-gold-deep">
          <p className="font-medium">Sequences never bypass the comms gate.</p>
          <p className="mt-1">
            A sequence is a green-zone education/invitation drip. Every enrolled send still passes the 7-step comms dispatcher gate
            — valid consent on channel, quiet hours, DNC, approved template, no individualized recommendation, and not
            securities-flagged — per recipient at dispatch time. Enrolling a contact does not send anything that fails the gate.
          </p>
        </div>

        {!sequences.ok ? (
          <ErrorState description={sequences.kind === 'not_configured' ? 'Database not configured.' : sequences.message} />
        ) : (
          <>
            {sequences.data.length === 0 ? (
              <EmptyState title="No sequences yet" description="Create a draft sequence below. It stays draft until you activate it." />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Steps</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sequences.data.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell><Badge variant="outline">{s.channel}</Badge></TableCell>
                        <TableCell className="capitalize text-muted-foreground">{(s.category ?? '').replace(/_/g, ' ') || '—'}</TableCell>
                        <TableCell>{Array.isArray(s.steps) ? s.steps.length : 0}</TableCell>
                        <TableCell><Badge variant={s.status === 'active' ? 'active' : s.status === 'archived' ? 'outline' : 'draft'}>{s.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">New sequence</p>
              <SequenceCreateForm />
            </div>
          </>
        )}
      </div>
    </ListShell>
  )
}
