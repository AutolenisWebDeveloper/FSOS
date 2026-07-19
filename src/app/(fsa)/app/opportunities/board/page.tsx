import Link from 'next/link'
import { List } from 'lucide-react'
import { BoardShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { load } from '@/lib/data/query'
import { OpportunityBoard, type OppCard } from '@/components/app/OpportunityBoard'

export const dynamic = 'force-dynamic'

// OS-09 Opportunity Board (A4 Kanban). Stage change writes stage_history + audit;
// securities-scope gate enforced server-side on advance.
export default async function OpportunityBoardPage() {
  const [opps, households] = await Promise.all([
    load<{ id: string; household_id: string | null; engagement: string; stage: string; is_security: boolean; premium: number | null }[]>(
      (db) => db.from('opportunities').select('id, household_id, engagement, stage, is_security, premium').is('deleted_at', null).order('created_at', { ascending: false }),
      [],
    ),
    load<{ id: string; primary_name: string }[]>((db) => db.from('households').select('id, primary_name').is('deleted_at', null), []),
  ])

  const actions = (
    <Button asChild variant="outline"><Link href="/app/opportunities"><List className="h-4 w-4" /> List</Link></Button>
  )

  if (!opps.ok) {
    return (
      <BoardShell title="Pipeline" description="Kanban across stages." actions={actions}>
        {opps.kind === 'not_configured' ? <EmptyState title="Database not configured" description="Set Supabase env vars." /> : <ErrorState description={opps.message} />}
      </BoardShell>
    )
  }

  const hhMap = new Map((households.ok ? households.data : []).map((h) => [h.id, h.primary_name]))
  const cards: OppCard[] = opps.data.map((o) => ({ id: o.id, household_name: o.household_id ? hhMap.get(o.household_id) ?? null : null, engagement: o.engagement, stage: o.stage, is_security: o.is_security, premium: o.premium }))

  return (
    <BoardShell title="Pipeline" description="Move opportunities across stages. Securities opportunities are scope-gated and never auto-contacted." actions={actions}>
      {cards.length === 0 ? (
        <EmptyState title="No opportunities yet" description="Convert a referral to originate your first opportunity." action={<Button asChild><Link href="/app/referrals">Go to referrals</Link></Button>} />
      ) : (
        <OpportunityBoard cards={cards} />
      )}
    </BoardShell>
  )
}
