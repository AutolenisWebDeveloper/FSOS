import Link from 'next/link'
import { EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { CampaignBuilder } from '@/components/app/CampaignControls'

export const dynamic = 'force-dynamic'

// OS-12 Campaign Builder (A6). Only APPROVED templates are selectable.
export default async function NewCampaignPage() {
  const templates = await load<{ id: string; name: string; channel: string; category: string | null }[]>(
    (db) => db.from('comm_templates').select('id, name, channel, category').eq('approval_status', 'approved').is('archived_at', null).order('name'),
    [],
  )
  const list = (templates.ok ? templates.data : []).map((t) => ({ id: t.id, name: t.name, channel: t.channel, category: t.category ?? 'educational' }))

  // Slice 7 — ACTIVE delegations WITH a represented agency owner (the on-behalf-of picker).
  // Only real, active delegations are offered; the gate re-verifies per send. No invented data.
  const delegations = await load<{ id: string; agency_owner_id: string; agency_owners: { full_name: string } | null }[]>(
    (db) => db
      .from('agency_communication_delegations')
      .select('id, agency_owner_id, agency_owners!inner(full_name)')
      .eq('status', 'ACTIVE')
      .not('agency_owner_id', 'is', null)
      .order('created_at', { ascending: false }),
    [],
  )
  const delegationOptions = (delegations.ok ? delegations.data : [])
    .filter((d) => d.agency_owner_id && d.agency_owners?.full_name)
    .map((d) => ({ id: d.id, ownerId: d.agency_owner_id, ownerName: d.agency_owners!.full_name }))

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="No approved templates"
          description="A campaign needs an approved template. Create one and have compliance approve it first."
          action={<Button asChild><Link href="/app/comms/templates">Go to templates</Link></Button>}
        />
      </div>
    )
  }

  return <CampaignBuilder templates={list} delegations={delegationOptions} />
}
