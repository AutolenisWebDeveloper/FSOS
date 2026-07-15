import { ListShell, EmptyState } from '@/components/archetypes'

export const dynamic = 'force-dynamic'

// P-4 Messages (A2-timeline). Consented comms with the FSA — through the gate.
export default function PartnerMessagesPage() {
  return (
    <ListShell title="Messages" description="Consented messages with your FSA. Every message honors consent + quiet hours." breadcrumb={[{ label: 'Partner', href: '/partner' }, { label: 'Messages' }]}>
      <EmptyState title="No messages yet" description="Messages with your FSA appear here. There is no securities content in this portal." />
    </ListShell>
  )
}
