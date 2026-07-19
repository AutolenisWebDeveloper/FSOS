import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// Two-way inbox. Every inbound + outbound message threads into ONE conversation per
// contact per channel, auto-associated to member/household/agency. Securities threads
// are flagged and never auto-replied. STOP/START opt-out is honored on inbound.
interface Conv {
  id: string
  channel: string
  contact: string
  member_id: string | null
  household_id: string | null
  status: string
  is_security: boolean
  ai_autoreply: boolean
  unread_count: number
  last_direction: string | null
  last_message_at: string | null
}

export default async function InboxPage() {
  const convs = await load<Conv[]>(
    (db) =>
      db
        .from('comm_conversations')
        .select('id, channel, contact, member_id, household_id, status, is_security, ai_autoreply, unread_count, last_direction, last_message_at')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(200),
    [],
  )

  return (
    <ListShell
      title="Inbox"
      description="Two-way SMS + email threads. Replies pass the 7-step gate; securities threads route to a human."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Inbox' }]}
    >
      {!convs.ok ? (
        <ErrorState description={convs.kind === 'not_configured' ? 'Database not configured.' : convs.message} />
      ) : convs.data.length === 0 ? (
        <EmptyState title="No conversations yet" description="Inbound SMS/email and replies appear here, threaded by contact." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Linked</TableHead>
                <TableHead>Last</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {convs.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.contact}
                    {c.unread_count > 0 ? <Badge variant="pending" className="ml-2">{c.unread_count} new</Badge> : null}
                  </TableCell>
                  <TableCell><Badge variant="outline">{c.channel}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.household_id ? (
                      <Link className="underline" href={`/app/households/${c.household_id}`}>household</Link>
                    ) : (
                      <span>unlinked</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Numeric>{c.last_message_at ? new Date(c.last_message_at).toLocaleString('en-US') : '—'}</Numeric>
                    {c.last_direction ? <span className="ml-1 text-xs">({c.last_direction})</span> : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.is_security ? <Badge variant="blocked">securities</Badge> : null}
                      {c.ai_autoreply ? <Badge variant="won">AI auto-reply</Badge> : null}
                      {c.status !== 'open' ? <Badge variant="outline">{c.status}</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell><Link className="text-sm underline" href={`/app/comms/inbox/${c.id}`}>Open</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
