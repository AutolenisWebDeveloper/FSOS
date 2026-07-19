import { ListShell, EmptyState, ErrorState, StatusBadge, type StatusKey } from '@/components/archetypes'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface ConsentRow {
  id: string
  member_id: string | null
  household_id: string | null
  channel: string
  status: string
  source: string | null
  captured_at: string | null
}

const breadcrumb = [
  { label: 'FSA', href: '/app' },
  { label: 'Compliance', href: '/app/compliance' },
  { label: 'Consent' },
]

const STATUS_MAP: Record<string, StatusKey> = { granted: 'won', revoked: 'lost' }

// OS Compliance — channel consent ledger (A2). Read-only.
export default async function ConsentPage() {
  const res = await load<ConsentRow[]>(
    (db) =>
      db
        .from('consents')
        .select('id, member_id, household_id, channel, status, source, captured_at')
        .order('captured_at', { ascending: false }),
    [],
  )

  let body: React.ReactNode
  if (!res.ok) {
    body = <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  } else if (res.data.length === 0) {
    body = <EmptyState title="No consent records yet" description="Consent is captured as clients opt in to each channel." />
  } else {
    body = (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Household</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Captured</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium capitalize">{c.channel}</TableCell>
                <TableCell><StatusBadge status={STATUS_MAP[c.status] ?? 'pending'} label={c.status} /></TableCell>
                <TableCell className="text-muted-foreground">{c.household_id ? <Numeric className="font-mono text-xs">{c.household_id}</Numeric> : '—'}</TableCell>
                <TableCell className="text-muted-foreground">{c.member_id ? <Numeric className="font-mono text-xs">{c.member_id}</Numeric> : '—'}</TableCell>
                <TableCell className="text-muted-foreground">{c.source ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{c.captured_at ? <Numeric>{new Date(c.captured_at).toLocaleDateString('en-US')}</Numeric> : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <ListShell title="Consent" description="Per-channel consent records driving comms eligibility." breadcrumb={breadcrumb}>
      {body}
    </ListShell>
  )
}
