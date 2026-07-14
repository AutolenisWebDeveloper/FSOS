import { DashboardShell, StatTile } from '@/components/archetypes'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-01 Executive Dashboard (A1, P0). Real book-at-a-glance counts. Each widget is
// wrapped in its own load() with a 0 fallback so a single failing count never blanks
// the whole page, and every tile links to a P0 route that exists (no dead ends).
type IdRow = { id: string }

async function countOf(fn: Parameters<typeof load<IdRow[]>>[0]): Promise<number> {
  const res = await load<IdRow[]>(fn, [])
  return res.ok ? res.data.length : 0
}

export default async function FsaDashboardPage() {
  const [
    agencies,
    referralsAwaiting,
    openOpportunities,
    households,
    policies,
    escalations,
    overdueTasks,
  ] = await Promise.all([
    countOf((db) => db.from('agency_partnerships').select('id').is('deleted_at', null)),
    countOf((db) => db.from('v_referrals_awaiting_action').select('id')),
    countOf((db) =>
      db
        .from('opportunities')
        .select('id')
        .is('deleted_at', null)
        .not('stage', 'in', '("placed_issued","lost")'),
    ),
    countOf((db) => db.from('households').select('id').is('deleted_at', null)),
    countOf((db) => db.from('household_policies').select('id').is('deleted_at', null)),
    countOf((db) =>
      db.from('agent_actions').select('id').eq('kind', 'escalation').or('outcome.eq.escalated,outcome.is.null'),
    ),
    countOf((db) =>
      db
        .from('work_tasks')
        .select('id')
        .eq('completed', false)
        .lt('due_at', new Date().toISOString())
        .is('deleted_at', null),
    ),
  ])

  return (
    <DashboardShell title="Executive Dashboard" description="Your book at a glance.">
      <StatTile label="Agency partnerships" value={agencies} href="/app/agencies" hint="Aggregate root of FSOS" />
      <StatTile label="Referrals awaiting action" value={referralsAwaiting} href="/app/referrals" hint="Speed-to-lead" />
      <StatTile label="Open opportunities" value={openOpportunities} href="/app/opportunities/board" hint="In pipeline" />
      <StatTile label="Households" value={households} href="/app/households" />
      <StatTile label="Policies" value={policies} href="/app/policies" />
      <StatTile label="AI escalations" value={escalations} href="/app/ai/escalations" hint="Awaiting human review" />
      <StatTile label="Overdue tasks" value={overdueTasks} href="/app/tasks" hint="Past due" />
    </DashboardShell>
  )
}
