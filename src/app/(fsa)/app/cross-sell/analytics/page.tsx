import { ReportShell, ErrorState, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-08 Cross-Sell Analytics (A11).
export default async function CrossSellAnalyticsPage() {
  const [gaps, activity] = await Promise.all([
    load<{ household_id: string; has_life: boolean }[]>((db) => db.from('v_cross_sell_gaps').select('household_id, has_life'), []),
    load<{ kind: string | null }[]>((db) => db.from('activities').select('kind').eq('entity_type', 'household').like('kind', 'crosssell_%').limit(5000), []),
  ])
  if (!gaps.ok) return <ReportShell title="Cross-Sell Analytics"><ErrorState description={gaps.kind === 'not_configured' ? 'Database not configured.' : gaps.message} /></ReportShell>
  const acts = activity.ok ? activity.data : []
  const count = (k: string) => acts.filter((a) => a.kind === `crosssell_${k}`).length

  return (
    <ReportShell title="Cross-Sell Analytics" description="Gaps identified, invited, reviews scheduled. Invitation only.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Gaps identified" value={gaps.data.length} href="/app/cross-sell" />
        <StatTile label="No-life households" value={gaps.data.filter((g) => !g.has_life).length} href="/app/cross-sell/household-gaps" />
        <StatTile label="Invites / education" value={count('invite') + count('educate')} href="/app/cross-sell" />
        <StatTile label="Reviews scheduled" value={count('schedule')} href="/app/reviews" />
      </div>
    </ReportShell>
  )
}
