import { DashboardShell, StatTile } from '@/components/archetypes'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor, compDisclosureEnabled } from '@/lib/portal/scope'
import { PARTNER_ALLOWLIST, selectFor } from '@/lib/portal/allowlist'

export const dynamic = 'force-dynamic'

// P-4 Partner Dashboard (A1). Scoped to the owner's agencies; commission widget
// hidden entirely when comp-disclosure config is off. No other agency's data.
export default async function PartnerDashboardPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []
  const showComp = await compDisclosureEnabled(agencyIds)

  let referralCount = 0
  let production = 0
  if (agencyIds.length) {
    const db = getDb()
    const { data: refs } = await db.from('referrals').select(selectFor(PARTNER_ALLOWLIST, 'referrals')).in('referring_agency_id', agencyIds).is('deleted_at', null)
    referralCount = refs?.length ?? 0
    const { data: agencies } = await db.from('agency_partnerships').select('ytd_placed_premium').in('id', agencyIds)
    production = (agencies ?? []).reduce((s: number, a: { ytd_placed_premium: number }) => s + Number(a.ytd_placed_premium || 0), 0)
  }

  return (
    <DashboardShell title="Agency-Owner Portal" description="Your referrals and production. You only ever see your own agency's data.">
      <StatTile label="My referrals" value={referralCount} href="/partner/referrals" />
      <StatTile label="Production (premium)" value={`$${Math.round(production).toLocaleString('en-US')}`} href="/partner/production" />
      <StatTile label="Submit a referral" value="→" href="/partner/refer" />
      {showComp ? <StatTile label="Attributed commissions" value="View" href="/partner/commissions" hint="Comp disclosure enabled" /> : <StatTile label="Materials" value="View" href="/partner/materials" />}
    </DashboardShell>
  )
}
