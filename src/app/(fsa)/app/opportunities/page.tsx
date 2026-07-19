import Link from 'next/link'
import { Plus, LayoutGrid } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { OpportunityList } from '@/components/app/OpportunityList'
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
    body = <OpportunityList rows={rows} />
  }

  return (
    <ListShell title="Opportunities" description="Your pipeline across engagement models." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Opportunities' }]} actions={actions}>
      {body}
    </ListShell>
  )
}
