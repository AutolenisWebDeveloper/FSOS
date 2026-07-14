import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { HouseholdList, type HouseholdRow } from '@/components/app/HouseholdList'

export const dynamic = 'force-dynamic'

// OS-04 Household Directory (A2).
export default async function HouseholdsPage() {
  const [households, members, policies, opps, agencies] = await Promise.all([
    load<{ id: string; primary_name: string; referring_agency_id: string | null; do_not_contact: boolean; archived_at: string | null }[]>(
      (db) => db.from('households').select('id, primary_name, referring_agency_id, do_not_contact, archived_at').is('deleted_at', null).order('created_at', { ascending: false }),
      [],
    ),
    load<{ household_id: string }[]>((db) => db.from('household_members').select('household_id').is('deleted_at', null), []),
    load<{ household_id: string }[]>((db) => db.from('household_policies').select('household_id').is('deleted_at', null), []),
    load<{ household_id: string | null; stage: string }[]>((db) => db.from('opportunities').select('household_id, stage').is('deleted_at', null), []),
    load<{ id: string; agency_name: string }[]>((db) => db.from('agency_partnerships').select('id, agency_name').is('deleted_at', null), []),
  ])

  const actions = (
    <Button asChild>
      <Link href="/app/households/new"><Plus className="h-4 w-4" /> Add household</Link>
    </Button>
  )

  let body: React.ReactNode
  if (!households.ok) {
    body = households.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load households." /> : <ErrorState description={households.message} />
  } else {
    const count = (arr: { household_id: string | null }[], id: string) => arr.filter((x) => x.household_id === id).length
    const agencyMap = new Map((agencies.ok ? agencies.data : []).map((a) => [a.id, a.agency_name]))
    const memberRows = members.ok ? members.data : []
    const policyRows = policies.ok ? policies.data : []
    const oppRows = (opps.ok ? opps.data : []).filter((o) => o.stage !== 'placed_issued' && o.stage !== 'lost')
    const rows: HouseholdRow[] = households.data.map((h) => ({
      id: h.id,
      primary_name: h.primary_name,
      agency_name: h.referring_agency_id ? agencyMap.get(h.referring_agency_id) ?? null : null,
      members: count(memberRows, h.id),
      policies: count(policyRows, h.id),
      opportunities: count(oppRows, h.id),
      do_not_contact: h.do_not_contact,
      archived_at: h.archived_at,
    }))
    body = <HouseholdList rows={rows} />
  }

  return (
    <ListShell title="Households" description="Client households in your book." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Households' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
