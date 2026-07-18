import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
import { ConversationReply, AutoReplyToggle } from '@/components/app/ConversationReply'

export const dynamic = 'force-dynamic'

interface Conv {
  id: string
  channel: string
  contact: string
  household_id: string | null
  member_id: string | null
  status: string
  is_security: boolean
  ai_autoreply: boolean
}
interface Msg {
  id: string
  direction: string
  body: string | null
  subject: string | null
  delivery_status: string
  blocked_step: string | null
  block_reason: string | null
  ai_generated: boolean
  opened_at: string | null
  clicked_at: string | null
  created_at: string
}

export default async function ThreadPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const convRes = await load<Conv | null>(
    (db) => db.from('comm_conversations').select('id, channel, contact, household_id, member_id, status, is_security, ai_autoreply').eq('id', id).maybeSingle(),
    null,
  )
  if (convRes.ok && !convRes.data) notFound()
  const conv = convRes.ok ? convRes.data! : null

  const msgs = await load<Msg[]>(
    (db) =>
      db
        .from('comm_messages')
        .select('id, direction, body, subject, delivery_status, blocked_step, block_reason, ai_generated, opened_at, clicked_at, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true })
        .limit(500),
    [],
  )

  return (
    <DetailShell
      title={conv ? `${conv.contact}` : 'Conversation'}
      description={conv ? `${conv.channel} thread` : ''}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Inbox', href: '/app/comms/inbox' }, { label: 'Thread' }]}
      actions={
        conv ? (
          <div className="flex items-center gap-2">
            {conv.household_id ? (
              <Link className="text-sm underline" href={`/app/households/${conv.household_id}`}>View household</Link>
            ) : (
              <span className="text-xs text-muted-foreground">Unlinked contact</span>
            )}
            {!conv.is_security ? <AutoReplyToggle id={conv.id} enabled={conv.ai_autoreply} /> : null}
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {conv?.is_security ? <Badge variant="blocked">Securities-flagged — excluded from automation</Badge> : null}

        <div className="space-y-2">
          {msgs.ok && msgs.data.length > 0 ? (
            msgs.data.map((m) => (
              <div key={m.id} className={m.direction === 'inbound' ? 'flex justify-start' : 'flex justify-end'}>
                <div className={`max-w-[80%] rounded-lg border p-3 text-sm ${m.direction === 'inbound' ? 'bg-muted/40' : 'bg-primary/5'}`}>
                  {m.subject ? <div className="mb-1 font-medium">{m.subject}</div> : null}
                  <div className="whitespace-pre-wrap">{m.body ?? '—'}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Numeric>{new Date(m.created_at).toLocaleString('en-US')}</Numeric>
                    <Badge variant={m.delivery_status === 'blocked' ? 'blocked' : m.delivery_status === 'delivered' || m.delivery_status === 'sent' ? 'won' : m.delivery_status === 'received' ? 'outline' : 'pending'}>{m.delivery_status}</Badge>
                    {m.ai_generated ? <Badge variant="outline">AI</Badge> : null}
                    {m.opened_at ? <span>opened</span> : null}
                    {m.clicked_at ? <span>clicked</span> : null}
                    {m.blocked_step ? <span className="text-status-blocked">blocked: {m.blocked_step}</span> : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No messages in this thread yet.</p>
          )}
        </div>

        {conv ? <ConversationReply id={conv.id} channel={conv.channel} isSecurity={conv.is_security} /> : null}
      </div>
    </DetailShell>
  )
}
