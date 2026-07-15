import { ReportShell, ErrorState, EmptyState } from '@/components/archetypes'
import { StatTile } from '@/components/archetypes'
import { Money } from '@/components/ui/typography'
import { getServerSession } from '@/lib/auth/session'
import { getDb } from '@/lib/supabase/client'
import { agencyIdsFor } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'

// P-4 Production (A11). Referral→placement counts + premium attributed to this agency.
export default async function PartnerProductionPage() {
  const session = await getServerSession()
  const agencyIds = session ? await agencyIdsFor(session) : []
  let referrals = 0, placedPremium = 0, err: string | null = null
  if (agencyIds.length) {
    try {
      const db = getDb()
      const { data: agencies } = await db.from('agency_partnerships').select('ytd_referrals, ytd_placed_premium').in('id', agencyIds)
      referrals = (agencies ?? []).reduce((s: number, a: { ytd_referrals: number }) => s + Number(a.ytd_referrals || 0), 0)
      placedPremium = (agencies ?? []).reduce((s: number, a: { ytd_placed_premium: number }) => s + Number(a.ytd_placed_premium || 0), 0)
    } catch (e) { err = e instanceof Error ? e.message : 'Failed' }
  }

  return (
    <ReportShell title="Production" description="Your agency's referral-to-placement production.">
      {err ? <ErrorState description={err} /> : agencyIds.length === 0 ? <EmptyState title="No agency scope" description="This account is not linked to an agency." /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile label="YTD referrals" value={referrals} href="/partner/referrals" />
          <StatTile label="Placed premium" value={<Money value={placedPremium} />} href="/partner/referrals" />
        </div>
      )}
    </ReportShell>
  )
}
