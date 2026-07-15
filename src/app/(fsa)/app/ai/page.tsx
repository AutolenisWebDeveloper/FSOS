import Link from 'next/link'
import { DashboardShell, StatTile, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-15 AI Operations Center (A1). Kill-switch state visible; every widget links.
export default async function AiCenterPage() {
  const [agents, runs, escalations, policy] = await Promise.all([
    load<{ key: string; enabled: boolean }[]>((db) => db.from('ai_agents').select('key, enabled'), []),
    load<{ id: string; status: string; cost_usd: number; started_at: string }[]>((db) => db.from('agent_runs').select('id, status, cost_usd, started_at').gte('started_at', new Date(Date.now() - 86400000).toISOString()).limit(1000), []),
    load<{ id: string }[]>((db) => db.from('agent_actions').select('id').eq('kind', 'escalation').eq('outcome', 'escalated').limit(1000), []),
    load<{ gateway_enabled: boolean } | null>((db) => db.from('ai_policies').select('gateway_enabled').eq('id', 'global').maybeSingle(), null),
  ])
  if (!agents.ok) return <DashboardShell title="AI Operations">{agents.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={agents.message} />}</DashboardShell>

  const active = agents.data.filter((a) => a.enabled).length
  const runsToday = runs.ok ? runs.data.length : 0
  const errors = runs.ok ? runs.data.filter((r) => r.status === 'errored').length : 0
  const cost = runs.ok ? runs.data.reduce((s, r) => s + Number(r.cost_usd || 0), 0) : 0
  const gatewayOn = policy.ok ? policy.data?.gateway_enabled !== false : true

  return (
    <DashboardShell title="AI Operations" description="Observe and control the autonomous system. Every run is logged with confidence + cost.">
      <StatTile label="Active agents" value={`${active}/${agents.data.length}`} href="/app/ai/agents" />
      <StatTile label="Runs (24h)" value={runsToday} href="/app/ai/runs" />
      <StatTile label="Escalations open" value={escalations.ok ? escalations.data.length : 0} href="/app/ai/escalations" />
      <StatTile label="Errors (24h)" value={errors} href="/app/ai/errors" />
      <StatTile label="AI spend (24h)" value={`$${cost.toFixed(2)}`} href="/app/ai/runs" />
      <StatTile label="Evaluations" value="View" href="/app/ai/evaluations" hint="Guardrail false-negatives" />
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <span className="font-medium">Global gateway kill switch:</span>
          <Badge variant={gatewayOn ? 'won' : 'blocked'}>{gatewayOn ? 'enabled' : 'disabled'}</Badge>
          <Link href="/super/ai/policies" className="text-primary hover:underline">Manage kill switches</Link>
          <span className="text-muted-foreground">A disabled agent stops at its next run start.</span>
        </div>
      </div>
    </DashboardShell>
  )
}
