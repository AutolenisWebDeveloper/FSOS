import { ListShell, EmptyState, ErrorState } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

interface DncRow {
  id: string
  contact: string
  channel: string
  scope: string
  reason: string | null
  created_at: string
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Compliance', href: '/app/compliance' },
  { label: 'Do-not-contact' },
]

// OS Compliance — do-not-contact ledger (A2). Read-only.
export default async function DncPage() {
  const res = await load<DncRow[]>(
    (db) => db.from('dnc_entries').select('id, contact, channel, scope, reason, created_at').order('created_at', { ascending: false }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  } else if (res.data.length === 0) {
    body = <EmptyState title="Do-not-contact list is empty" description="Suppressed contacts appear here and are excluded from every automated send." />
  } else {
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.contact}</TableCell>
                <TableCell className="text-muted-foreground capitalize">{d.channel}</TableCell>
                <TableCell>
                  {d.scope === 'external' ? <Badge variant="blocked">external</Badge> : <Badge variant="secondary" className="capitalize">{d.scope}</Badge>}
                </TableCell>
                <TableCell className="text-muted-foreground">{d.reason ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString('en-US')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell title="Do-Not-Contact" description="Internal and external suppression list." breadcrumb={breadcrumb}>
      {body}
    </ListShell>
  )
}
