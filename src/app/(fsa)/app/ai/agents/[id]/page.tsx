import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { AGENT_ROSTER } from '@/lib/ai/roster'
import { AgentToggle } from '@/components/app/AgentToggle'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

// OS-15 Agent Detail (A3). Tools are green-zone only; none holds a "recommend" tool.
export default async function AgentDetailPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; key: string; name: string; enabled: boolean; is_guardrail: boolean; mission: string | null } | null>(
    (db) => db.from('ai_agents').select('*').eq('key', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const a = res.data
  if (!a) notFound()
  const def = AGENT_ROSTER[a.key]

  const runs = await load<{ id: string; status: string; cost_usd: number; confidence: number | null; started_at: string }[]>(
    (db) => db.from('agent_runs').select('id, status, cost_usd, confidence, started_at').eq('agent_key', a.key).order('started_at', { ascending: false }).limit(10),
    [],
  )

  return (
    <DetailShell
      title={a.name}
      description={def?.mission ?? a.mission ?? ''}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI', href: '/app/ai' }, { label: 'Agents', href: '/app/ai/agents' }, { label: a.name }]}
      status={<span className="flex items-center gap-2"><Badge variant={a.enabled ? 'won' : 'lost'}>{a.enabled ? 'enabled' : 'disabled'}</Badge>{a.is_guardrail ? <Badge variant="blocked">guardrail — super+2FA to disable</Badge> : null}</span>}
      actions={<AgentToggle agentKey={a.key} enabled={a.enabled} isGuardrail={a.is_guardrail} />}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Permitted tools (green-zone only)</CardTitle></CardHeader>
        <CardContent>
          {def ? (
            <div className="flex flex-wrap gap-2">{def.tools.map((t) => (<Badge key={t} variant="outline">{t.replace(/_/g, ' ')}</Badge>))}</div>
          ) : <p className="text-sm text-muted-foreground">No tool definition.</p>}
          <p className="mt-3 text-xs text-muted-foreground">No agent holds a &quot;recommend product&quot; tool. Every client-facing action passes the Compliance Guardrail before dispatch.</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Triggers</span><span>{def?.triggers ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Confidence threshold</span><span>{def ? def.confidenceThreshold : '—'}</span></div>
            <p className="pt-2 text-xs text-muted-foreground">Editing agent config is super-admin only (/super/ai). FSA can enable/disable + review.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {runs.ok && runs.data.length > 0 ? runs.data.map((r) => (
              <Link key={r.id} href={`/app/ai/runs/${r.id}`} className="flex justify-between border-b py-1 last:border-0 hover:text-primary">
                <span><Numeric>{new Date(r.started_at).toLocaleString('en-US')}</Numeric></span>
                <span><Badge variant={r.status === 'completed' ? 'won' : r.status === 'errored' ? 'lost' : 'pending'}>{r.status}</Badge> <Numeric>{`$${Number(r.cost_usd).toFixed(3)}`}</Numeric></span>
              </Link>
            )) : <p className="text-muted-foreground">No runs yet.</p>}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  )
}
