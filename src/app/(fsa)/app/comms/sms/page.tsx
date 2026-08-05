import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { MessageLogTable } from '@/components/comms/MessageLogTable'
import { loadMessageLog } from '@/lib/comms/message-log'

export const dynamic = 'force-dynamic'

// OS-12 SMS Inbox (A2). Replying to a securities-flagged thread is blocked + escalated;
// opt-out (STOP) is honored immediately via the consent/DNC sync.
//
// The table, status vocabulary, and timestamp handling are shared with the email view
// (components/comms/MessageLogTable) — this page contributes only its channel filter
// and its copy. Channel column is dropped: every row here is SMS.
export default async function SmsPage() {
  const msgs = await loadMessageLog({ channel: 'sms' })

  return (
    <ListShell
      title="SMS"
      description="Consented SMS threads. Every send passes the 7-step gate; STOP opts out immediately."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'SMS' }]}
    >
      {!msgs.ok ? (
        <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
      ) : msgs.data.length === 0 ? (
        <EmptyState title="No SMS yet" description="Inbound and outbound SMS appears here with the gate result for each send." />
      ) : (
        <MessageLogTable rows={msgs.data} caption="SMS messages, most recent first" showChannel={false} showBody />
      )}
    </ListShell>
  )
}
