import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'

export const dynamic = 'force-dynamic'

// OS-15 Run Detail (A3). Inputs, model, tool calls, output, confidence, cost, guardrail
// result, audit link — traceable end-to-end.
export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; agent_key: string; status: string; model: string | null; input: unknown; input_tokens: number; output_tokens: number; cost_usd: number; confidence: number | null; error: string | null; started_at: string; finished_at: string | null } | null>(
    (db) => db.from('agent_runs').select('*').eq('id', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const r = res.data
  if (!r) notFound()

  const actions = await load<{ id: string; kind: string; outcome: string | null; reason: string | null; blocked_step: string | null; target_type: string | null; created_at: string }[]>(
    (db) => db.from('agent_actions').select('id, kind, outcome, reason, blocked_step, target_type, created_at').eq('run_id', params.id).order('created_at'),
    [],
  )

  return (
    <DetailShell
      title={`Run — ${r.agent_key}`}
      description={`${r.model ?? 'no model'} · ${new Date(r.started_at).toLocaleString('en-US')}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI', href: '/app/ai' }, { label: 'Runs', href: '/app/ai/runs' }, { label: r.agent_key }]}
      status={<StatusBadge status={r.status === 'completed' ? 'won' : r.status === 'errored' ? 'lost' : 'pending'} label={r.status} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">Metrics</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Input tokens</span><span>{r.input_tokens}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Output tokens</span><span>{r.output_tokens}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span>${Number(r.cost_usd).toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span>{r.confidence != null ? r.confidence.toFixed(2) : '—'}</span></div>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Input</CardTitle></CardHeader>
          <CardContent><pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(r.input, null, 2)}</pre></CardContent>
        </Card>
      </div>
      {r.error ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{r.error}</div> : null}
      <Card>
        <CardHeader><CardTitle className="text-base">Actions &amp; guardrail results</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {actions.ok && actions.data.length > 0 ? actions.data.map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b py-1 last:border-0">
              <span className="capitalize">{a.kind.replace(/_/g, ' ')}{a.target_type ? ` · ${a.target_type}` : ''}</span>
              <span className="text-xs text-muted-foreground">{a.outcome}{a.blocked_step ? ` · blocked: ${a.blocked_step}` : ''}{a.reason ? ` · ${a.reason}` : ''}</span>
            </div>
          )) : <p className="text-muted-foreground">No actions recorded.</p>}
          <p className="pt-2 text-xs text-muted-foreground">A blocked action shows the failing rule. Escalations route to <Link href="/app/ai/escalations" className="text-primary hover:underline">the queue</Link>.</p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
