import { SettingsShell, SettingsSection, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { WorkforceTargets, type TargetRow } from '@/components/app/WorkforceTargets'

export const dynamic = 'force-dynamic'

// Super · AI Workforce Quotas. The dial for "contact a targeted number of clients
// each day." Each daily_target is a CONFIG DEFAULT (is_assumption) until the operator
// verifies it by saving. The orchestrator never exceeds a target; a disabled row
// (or the agent's own kill switch) pauses that agent's outreach entirely.
export default async function SuperWorkforceTargetsPage() {
  const targets = await load<TargetRow[]>(
    (db) => db.from('agent_daily_targets').select('agent_key, daily_target, channel, enabled, is_assumption, note').order('agent_key'),
    [],
  )

  let body: React.ReactNode
  if (!targets.ok) {
    body = targets.kind === 'not_configured'
      ? <EmptyState title="Database not configured" description="Set Supabase env vars to manage workforce quotas." />
      : <ErrorState description={targets.message} />
  } else if (targets.data.length === 0) {
    body = <EmptyState title="No outreach agents configured" description="Quotas seed with migration 034." />
  } else {
    body = (
      <SettingsSection
        title="Daily contact quotas"
        description="Per-agent cap on proactive client outreach per day. Every message is drafted green-zone and sent only through the compliance gate (consent, quiet hours, DNC, no recommendations, securities firewall). Verify each config default before enabling live outreach."
      >
        <WorkforceTargets initial={targets.data} />
      </SettingsSection>
    )
  }

  return (
    <SettingsShell title="AI Workforce Quotas" description="How many clients each AI agent contacts per day.">
      {body}
    </SettingsShell>
  )
}
