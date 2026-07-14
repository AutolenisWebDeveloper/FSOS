import { SettingsShell, SettingsSection, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { AiPolicyToggles, type AgentToggle } from '@/components/app/AiPolicyToggles'

export const dynamic = 'force-dynamic'

// Super · AI Policies (A10). The kill-switch surface (CLAUDE.md §6). Loads the
// global gateway policy + agent roster and renders live toggles. The Compliance
// Guardrail agent renders disabled and cannot be turned off here.
export default async function SuperAiPoliciesPage() {
  const [policy, agents] = await Promise.all([
    load<{ id: string; gateway_enabled: boolean }[]>(
      (db) => db.from('ai_policies').select('id, gateway_enabled').eq('id', 'global'),
      [],
    ),
    load<AgentToggle[]>(
      (db) => db.from('ai_agents').select('key, name, enabled, is_guardrail').order('is_guardrail', { ascending: false }).order('name', { ascending: true }),
      [],
    ),
  ])

  let body: React.ReactNode
  if (!policy.ok || !agents.ok) {
    const failed = !policy.ok ? policy : agents
    body =
      !failed.ok && failed.kind === 'not_configured' ? (
        <EmptyState title="Database not configured" description="Set Supabase env vars to manage AI policies." />
      ) : (
        <ErrorState description={!failed.ok ? failed.message : undefined} />
      )
  } else {
    const global = policy.data[0]?.gateway_enabled ?? false
    body = (
      <>
        <SettingsSection
          title="Gateway kill switch"
          description="Global on/off for the model-agnostic AI gateway. Checked at every agent run start."
        >
          <AiPolicyToggles global={global} agents={[]} />
        </SettingsSection>
        <SettingsSection
          title="Agents"
          description="Per-agent enable/disable. All agents are green-zone; the Compliance Guardrail is the hard-block layer and cannot be disabled here."
        >
          {agents.data.length === 0 ? (
            <EmptyState title="No agents registered yet" description="Agent definitions appear here once seeded." />
          ) : (
            <AiPolicyToggles global={global} agents={agents.data} showGlobal={false} />
          )}
        </SettingsSection>
      </>
    )
  }

  return (
    <SettingsShell title="AI Policies" description="Kill switches for the AI gateway and each agent.">
      {body}
    </SettingsShell>
  )
}
