import { ListShell } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { ConsoleWorkbench } from './console-workbench'

export const dynamic = 'force-dynamic'

// Communications Command Console (feature spec v1) — the single operator console that can
// send an individual SMS/email, reuse any communication asset from any campaign, initiate
// an AI conversation with a chosen agent, and run a real per-campaign test send. It is an
// orchestration + UI layer over the EXISTING production send rails — NOT a new send path.
// Every outbound message here passes the same 7-step compliance gate campaigns use; there
// is no override control anywhere on this surface (spec §0).
export default function CommsConsolePage() {
  return (
    <ListShell
      title="Communications Console"
      description="Compose an individual message, reuse any campaign asset, or start an AI conversation — every send passes the same compliance gate as a campaign. There is no override."
      breadcrumb={[
        { label: 'Communications', href: '/app/comms' },
        { label: 'Console' },
      ]}
      actions={<Badge variant="outline">Gate-enforced · no force-send</Badge>}
    >
      <ConsoleWorkbench />
    </ListShell>
  )
}
