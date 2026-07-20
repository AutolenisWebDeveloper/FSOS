import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { AudienceBuilderForm } from '@/components/app/SequenceControls'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

type AudienceDefinition = { base?: string; has_life?: string; consented_only?: boolean; status?: string }
type AudienceRow = {
  id: string
  name: string
  definition: AudienceDefinition | null
  estimated_size: number | null
  created_at: string
}

// OS-13 Comms — audience builder (A5/A2). An audience is a segment DEFINITION only;
// the dispatcher re-checks the full comms gate per recipient at send time.
export default async function AudiencePage() {
  const audiences = await load<AudienceRow[]>(
    (db) => db.from('comm_audiences').select('id, name, definition, estimated_size, created_at').order('updated_at', { ascending: false }),
    [],
  )

  return (
    <ListShell
      title="Audience builder"
      description="Reusable segment definitions for campaigns and sequences."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Audience' }]}
    >
      <div className="space-y-6">
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-sm text-gold-deep">
          <p className="font-medium">An audience is a definition, not a send list.</p>
          <p className="mt-1">
            Estimated size is an approximate segment count. The actual dispatch re-checks the full comms gate — consent,
            quiet hours, DNC, approved template, no recommendation, not securities-flagged — for every recipient at send time.
          </p>
        </div>

        {!audiences.ok ? (
          <ErrorState description={audiences.kind === 'not_configured' ? 'Database not configured.' : audiences.message} />
        ) : (
          <>
            {audiences.data.length === 0 ? (
              <EmptyState title="No audiences yet" description="Define your first segment below." />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Base</TableHead>
                      <TableHead>Est. size</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audiences.data.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell><Badge variant="outline">{a.definition?.base ?? 'households'}</Badge></TableCell>
                        <TableCell><Numeric>{Number(a.estimated_size ?? 0).toLocaleString('en-US')}</Numeric></TableCell>
                        <TableCell className="text-muted-foreground"><Numeric>{new Date(a.created_at).toLocaleDateString('en-US')}</Numeric></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">New audience</p>
              <AudienceBuilderForm />
            </div>
          </>
        )}
      </div>
    </ListShell>
  )
}
