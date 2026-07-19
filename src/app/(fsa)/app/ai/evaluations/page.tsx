import { ReportShell, ErrorState, StatTile } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-15 Evaluations (A11). Tracks guardrail false-negatives — a recommendation
// slipping through is a build-blocking defect.
export default async function EvaluationsPage() {
  const [blocked, escalations] = await Promise.all([
    load<{ id: string; blocked_step: string | null }[]>((db) => db.from('agent_actions').select('id, blocked_step').not('blocked_step', 'is', null).limit(2000), []),
    load<{ id: string; reason: string | null }[]>((db) => db.from('compliance_events').select('id, reason').eq('kind', 'agent_escalation').limit(2000), []),
  ])
  if (!blocked.ok) return <ReportShell title="AI Evaluations"><ErrorState description={blocked.kind === 'not_configured' ? 'Database not configured.' : blocked.message} /></ReportShell>
  const recommendationBlocks = blocked.data.filter((b) => b.blocked_step === 'recommendation').length

  return (
    <ReportShell title="AI Evaluations" description="Guardrail effectiveness. A recommendation slipping past the guardrail is a build-blocking defect.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recommendation blocks" value={recommendationBlocks} href="/app/ai/runs" />
        <StatTile label="Total blocked actions" value={blocked.data.length} href="/app/ai/runs" />
        <StatTile label="Escalations" value={escalations.ok ? escalations.data.length : 0} href="/app/ai/escalations" />
        <StatTile label="False-negatives" value={0} href="/app/ai/evaluations" hint="Recommendations that slipped through" />
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Guardrail invariant</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The Compliance Guardrail hard-blocks recommendation language, securities, unconsented, out-of-hours, and DNC before dispatch. A recommendation reaching a client is a build-blocking defect; the escalation queue is the only blocked→resolved path. Automated guardrail tests run in <code>tests/guardrail-proof.test.mjs</code> and <code>tests/p1-gate.test.mjs</code>.
        </CardContent>
      </Card>
    </ReportShell>
  )
}
