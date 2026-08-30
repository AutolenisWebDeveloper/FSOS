import Link from 'next/link'
import { Plus, LayoutGrid, Target, TrendingUp, Wallet, ShieldAlert } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { OpportunityList } from '@/components/app/OpportunityList'
import { PageStatStrip, type PageStat } from '@/components/app/PageStatStrip'
import type { OppCard } from '@/components/app/OpportunityBoard'

export const dynamic = 'force-dynamic'

// OS-09 Opportunity Directory (A2).
export default async function OpportunitiesPage(props: { searchParams: Promise<{ household?: string }> }) {
  const searchParams = await props.searchParams;
  const [opps, households] = await Promise.all([
    load<{ id: string; household_id: string | null; engagement: string; stage: string; is_security: boolean; premium: number | null }[]>(
      (db) => {
        let q = db.from('opportunities').select('id, household_id, engagement, stage, is_security, premium').is('deleted_at', null).order('created_at', { ascending: false })
        if (searchParams.household) q = q.eq('household_id', searchParams.household)
        return q
      },
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])

  const actions = (
    <div className="flex gap-2">
      <Button asChild variant="outline"><Link href="/app/opportunities/board"><LayoutGrid className="h-4 w-4" /> Board</Link></Button>
      <Button asChild><Link href="/app/opportunities/new"><Plus className="h-4 w-4" /> New</Link></Button>
    </div>
  )

  let body: React.ReactNode
  if (!opps.ok) {
    body = opps.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars to load opportunities." /> : <ErrorState description={opps.message} />
  } else {
    const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))
    const rows: OppCard[] = opps.data.map((o) => ({ id: o.id, household_name: o.household_id ? hhMap.get(o.household_id) ?? null : null, engagement: o.engagement, stage: o.stage, is_security: o.is_security, premium: o.premium }))

    // Summary — computed from the opportunities already loaded (respects the
    // ?household filter, so it reflects "in view"). Open = not placed/lost.
    const open = opps.data.filter((o) => o.stage !== 'placed_issued' && o.stage !== 'lost')
    const openPremium = open.reduce((sum, o) => sum + (o.premium ?? 0), 0)
    const securities = opps.data.filter((o) => o.is_security).length
    const stats: PageStat[] = [
      { label: 'Opportunities', value: opps.data.length, hint: 'In view', icon: Target, accent: 'brand' },
      { label: 'Open pipeline', value: open.length, hint: 'Active stages', href: '/app/opportunities/board', icon: TrendingUp, accent: 'neutral' },
      { label: 'Open premium', value: openPremium, currency: true, hint: 'Un-weighted', href: '/app/forecasts', icon: Wallet, accent: 'positive' },
      { label: 'Securities-flagged', value: securities, hint: 'FFS-managed', icon: ShieldAlert, accent: 'security' },
    ]

    body = (
      <div className="space-y-6">
        <PageStatStrip stats={stats} />
        <OpportunityList rows={rows} />
      </div>
    )
  }

  return (
    <ListShell title="Opportunities" description="Your pipeline across engagement models." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Opportunities' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
