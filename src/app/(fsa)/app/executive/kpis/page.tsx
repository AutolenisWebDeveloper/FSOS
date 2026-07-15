import { DashboardShell, StatTile, ErrorState } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// Executive KPIs (A1).
export default async function KpisPage() {
  const [agencies, referrals, opps, commissions] = await Promise.all([
    load<{ id: string; status: string }[]>((db) => db.from('agency_partnerships').select('id, status').is('deleted_at', null), []),
    load<{ id: string; status: string }[]>((db) => db.from('referrals').select('id, status').is('deleted_at', null), []),
    load<{ id: string; stage: string; premium: number | null }[]>((db) => db.from('opportunities').select('id, stage, premium').is('deleted_at', null), []),
    load<{ total_commission: number }[]>((db) => db.from('commissions').select('total_commission'), []),
  ])
  if (!agencies.ok) return <DashboardShell title="KPIs">{agencies.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={agencies.message} />}</DashboardShell>

  const producing = agencies.data.filter((a) => a.status === 'producing').length
  const converted = referrals.ok ? referrals.data.filter((r) => r.status === 'converted').length : 0
  const referralTotal = referrals.ok ? referrals.data.length : 0
  const placed = opps.ok ? opps.data.filter((o) => o.stage === 'placed_issued').length : 0
  const premium = opps.ok ? opps.data.reduce((s, o) => s + Number(o.premium || 0), 0) : 0
  const commTotal = commissions.ok ? commissions.data.reduce((s, c) => s + Number(c.total_commission || 0), 0) : 0
  const convRate = referralTotal ? Math.round((converted / referralTotal) * 100) : 0

  return (
    <DashboardShell title="KPIs" description="Book-level performance indicators.">
      <StatTile label="Producing agencies" value={producing} href="/app/agencies" />
      <StatTile label="Referral conversion" value={`${convRate}%`} href="/app/referrals" hint={`${converted}/${referralTotal}`} />
      <StatTile label="Placed opportunities" value={placed} href="/app/opportunities" />
      <StatTile label="Pipeline premium" value={`$${Math.round(premium).toLocaleString('en-US')}`} href="/app/opportunities/board" />
      <StatTile label="Commission tracked" value={`$${Math.round(commTotal).toLocaleString('en-US')}`} href="/app/commissions" />
    </DashboardShell>
  )
}
