import { ListShell, EmptyState, ErrorState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface LicenseRow {
  id: string
  kind: string
  state: string | null
  status: string
  expires_on: string | null
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Compliance', href: '/app/compliance' },
  { label: 'Licenses' },
]

const STATUS_MAP: Record<string, StatusKey> = { active: 'won', expired: 'lost', pending: 'pending' }
const DAY = 24 * 60 * 60 * 1000

// OS Compliance — licensing status (A2). Read-only.
export default async function LicensesPage() {
  const res = await load<LicenseRow[]>(
    (db) => db.from('licenses').select('id, kind, state, status, expires_on').order('expires_on', { ascending: true }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  } else if (res.data.length === 0) {
    body = <EmptyState title="No licenses on file" description="Add license records to track appointment and CE status." />
  } else {
    const now = Date.now()
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((l) => {
              const days = l.expires_on ? Math.ceil((new Date(l.expires_on).getTime() - now) / DAY) : null
              const expiringSoon = l.status === 'active' && days !== null && days <= 60 && days >= 0
              return (
                <TableRow key={l.id} className={expiringSoon ? 'bg-status-pending/10' : undefined}>
                  <TableCell className="font-medium">{l.kind}</TableCell>
                  <TableCell className="text-muted-foreground">{l.state ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={STATUS_MAP[l.status] ?? 'active'} label={l.status} /></TableCell>
                  <TableCell className="text-muted-foreground">
                    {l.expires_on ? <Numeric>{new Date(l.expires_on).toLocaleDateString('en-US')}</Numeric> : '—'}
                    {expiringSoon ? <Badge variant="pending" className="ml-2">expires in {days}d</Badge> : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell title="Licenses" description="Life & securities licensing status." breadcrumb={breadcrumb}>
      {body}
    </ListShell>
  )
}
