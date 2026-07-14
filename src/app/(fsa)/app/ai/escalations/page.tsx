import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { EscalationList, type EscalationRow, type ComplianceEventRow } from '@/components/app/EscalationList'

export const dynamic = 'force-dynamic'

// AI Escalations Queue (A2) — the human-handoff surface. Every hard-blocked or
// judgment-required agent item lands here; it is the only path from blocked→resolved.
export default async function EscalationsPage() {
  const [escalations, complianceEvents] = await Promise.all([
    load<EscalationRow[]>(
      (db) =>
        db
          .from('agent_actions')
          .select('id, reason, blocked_step, target_type, target_id, outcome, created_at')
          .eq('kind', 'escalation')
          .order('created_at', { ascending: false }),
      [],
    ),
    load<ComplianceEventRow[]>(
      (db) =>
        db
          .from('compliance_events')
          .select('id, kind, channel, recipient, entity_type, entity_id, blocked_step, reason, created_at')
          .order('created_at', { ascending: false })
          .limit(25),
      [],
    ),
  ])

  let body: React.ReactNode
  if (!escalations.ok) {
    body =
      escalations.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to load escalations." />
      ) : (
        <ErrorState description={escalations.message} />
      )
  } else {
    body = <EscalationList rows={escalations.data} complianceEvents={complianceEvents.ok ? complianceEvents.data : []} />
  }

  return (
    <ListShell
      title="AI Escalations"
      description="Hard-blocked and judgment-required agent items, routed here for human handling."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI Escalations' }]}
    >
      {body}
    </ListShell>
  )
}
