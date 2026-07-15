import { ListShell, EmptyState, ErrorState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SecuritiesChip, securitiesRowClass } from '@/components/ui/securities'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface EventRow {
  id: string
  kind: string
  reason: string | null
  blocked_step: string | null
  entity_type: string | null
  recipient: string | null
  created_at: string
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Compliance', href: '/app/compliance' },
  { label: 'Firewall' },
]

// OS Compliance — firewall & comms-block ledger (A2). Read-only.
export default async function FirewallPage() {
  const res = await load<EventRow[]>(
    (db) =>
      db
        .from('compliance_events')
        .select('id, kind, reason, blocked_step, entity_type, recipient, created_at')
        .order('created_at', { ascending: false }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  } else if (res.data.length === 0) {
    body = <EmptyState title="No firewall events" description="No securities-firewall or comms blocks recorded." />
  } else {
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Blocked step</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((e) => {
              const isSecurities = /securit/i.test(`${e.reason ?? ''} ${e.blocked_step ?? ''}`)
              return (
                <TableRow key={e.id} className={isSecurities ? securitiesRowClass : undefined}>
                  <TableCell className="font-medium">{e.kind}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.reason ?? '—'}
                    {isSecurities ? <SecuritiesChip className="ml-2" /> : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.blocked_step ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{e.entity_type ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{e.recipient ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{new Date(e.created_at).toLocaleString('en-US')}</Numeric></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell title="Firewall & Comms Blocks" description="Securities-firewall and communications blocks, newest first." breadcrumb={breadcrumb}>
      {body}
    </ListShell>
  )
}
