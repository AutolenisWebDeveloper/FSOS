import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { MessageLogTable } from '@/components/comms/MessageLogTable'
import { loadMessageLog } from '@/lib/comms/message-log'

export const dynamic = 'force-dynamic'

// OS-12 Email Inbox (A2). Replying to a securities-flagged thread is blocked + escalated;
// unsubscribe is honored immediately via the consent/DNC sync.
//
// Shares MessageLogTable with the SMS view — see that file for why this page is thin.
export default async function EmailPage() {
  const msgs = await loadMessageLog({ channel: 'email' })

  return (
    <ListShell
      title="Email"
      description="Consented email threads. Every send passes the 7-step gate; unsubscribe is honored immediately."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Email' }]}
    >
      {!msgs.ok ? (
        <ErrorState description={msgs.kind === 'not_configured' ? 'Database not configured.' : msgs.message} />
      ) : msgs.data.length === 0 ? (
        <EmptyState title="No email yet" description="Inbound and outbound email appears here with the gate result for each send." />
      ) : (
        <MessageLogTable rows={msgs.data} caption="Email messages, most recent first" showChannel={false} showBody />
      )}
    </ListShell>
  )
}
