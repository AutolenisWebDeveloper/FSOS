import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-12 Suppression & opt-out (A2). Master DNC + per-channel opt-outs — authoritative
// over every campaign/agent. Suppression always wins.
export default async function SuppressionPage() {
  const [dnc, revoked] = await Promise.all([
    load<{ id: string; contact: string; channel: string; scope: string; reason: string | null }[]>((db) => db.from('dnc_entries').select('*').order('created_at', { ascending: false }).limit(500), []),
    load<{ id: string; channel: string; captured_at: string }[]>((db) => db.from('consents').select('id, channel, captured_at').eq('status', 'revoked').order('captured_at', { ascending: false }).limit(500), []),
  ])

  return (
    <ListShell title="Suppression & Opt-Out" description="Master DNC + per-channel opt-outs. Authoritative over every campaign and agent." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Suppression' }]}>
      {!dnc.ok ? (
        <ErrorState description={dnc.kind === 'not_configured' ? 'Database not configured.' : dnc.message} />
      ) : (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium">Do-not-contact list ({dnc.data.length})</p>
            {dnc.data.length === 0 ? <EmptyState title="DNC list empty" description="Opt-outs and STOP replies add entries here." /> : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Channel</TableHead><TableHead>Scope</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {dnc.data.map((d) => (
                      <TableRow key={d.id}><TableCell className="font-medium">{d.contact}</TableCell><TableCell><Badge variant="outline">{d.channel}</Badge></TableCell><TableCell className="text-muted-foreground">{d.scope}</TableCell><TableCell className="text-muted-foreground">{d.reason ?? '—'}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Revoked consents ({revoked.ok ? revoked.data.length : 0})</p>
            <p className="text-sm text-muted-foreground">A revoked consent immediately suppresses that channel — re-checked at send time.</p>
          </div>
        </div>
      )}
    </ListShell>
  )
}
