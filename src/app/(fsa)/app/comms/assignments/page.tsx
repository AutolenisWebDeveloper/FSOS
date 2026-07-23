import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Numeric } from '@/components/ui/typography'
import { load } from '@/lib/data/query'
import { ResolveActions } from './resolve-actions'

export const dynamic = 'force-dynamic'

// Slice 1 — Assignment-review queue (§6). Records whose communication ownership could
// not be confidently resolved are BLOCKED from sending and land here for authorized
// human resolution. The conflicting source data is shown; there is no "force send".
interface Review {
  id: string
  channel: string | null
  destination: string | null
  reason: string
  conflict: Record<string, unknown> | null
  status: string
  resolved_by: string | null
  resolution: string | null
  created_at: string
  resolved_at: string | null
}

export default async function AssignmentsPage() {
  const [open, recent] = await Promise.all([
    load<Review[]>(
      (db) =>
        db
          .from('comm_assignment_reviews')
          .select('id, channel, destination, reason, conflict, status, resolved_by, resolution, created_at, resolved_at')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(300),
      [],
    ),
    load<Review[]>(
      (db) =>
        db
          .from('comm_assignment_reviews')
          .select('id, channel, destination, reason, conflict, status, resolved_by, resolution, created_at, resolved_at')
          .neq('status', 'open')
          .order('resolved_at', { ascending: false })
          .limit(100),
      [],
    ),
  ])

  const nav = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><Link href="/app/comms">Timeline</Link></Button>
      <Button asChild variant="outline"><Link href="/app/comms/suppression">Suppression</Link></Button>
    </div>
  )

  return (
    <ListShell
      title="Assignment Review"
      description="Records whose communication ownership could not be resolved. Sending is blocked until an authorized user resolves the conflict — nothing is sent on ambiguous ownership."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Assignment Review' }]}
      actions={nav}
    >
      {!open.ok ? (
        <ErrorState description={open.kind === 'not_configured' ? 'Database not configured.' : open.message} />
      ) : (
        <div className="space-y-8">
          <section>
            <p className="mb-2 text-sm font-medium">Open ({open.data.length})</p>
            {open.data.length === 0 ? (
              <EmptyState
                title="No records awaiting review"
                description="When ownership can't be confidently resolved for a send, it is held here with the conflicting source data. Nothing outbound is waiting right now."
              />
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Why it's held</TableHead>
                      <TableHead className="text-right">Resolve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {open.data.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">
                          <Numeric>{new Date(r.created_at).toLocaleString('en-US')}</Numeric>
                        </TableCell>
                        <TableCell>{r.channel ? <Badge variant="outline">{r.channel}</Badge> : '—'}</TableCell>
                        <TableCell className="font-medium">{r.destination ?? '—'}</TableCell>
                        <TableCell className="max-w-md text-sm text-muted-foreground">{r.reason}</TableCell>
                        <TableCell className="text-right"><ResolveActions id={r.id} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          {recent.ok && recent.data.length > 0 && (
            <section>
              <p className="mb-2 text-sm font-medium">Recently resolved ({recent.data.length})</p>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Destination</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.data.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">
                          <Numeric>{r.resolved_at ? new Date(r.resolved_at).toLocaleString('en-US') : '—'}</Numeric>
                        </TableCell>
                        <TableCell className="font-medium">{r.destination ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'resolved' ? 'won' : 'outline'}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.resolved_by ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </div>
      )}
    </ListShell>
  )
}
