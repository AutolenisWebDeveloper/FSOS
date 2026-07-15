import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { EscalationActions } from '@/components/app/EscalationActions'
import { Numeric } from '@/components/ui/typography'

export const dynamic = 'force-dynamic'

interface Escalation {
  id: string
  run_id: string | null
  kind: string
  actor: string | null
  outcome: string | null
  target_type: string | null
  target_id: string | null
  reason: string | null
  blocked_step: string | null
  note: string | null
  drafted_content: string | null
  created_at: string
}

const RESOLVED = new Set(['handled', 'dismissed', 'reassigned'])
const TARGET_PATH: Record<string, string> = {
  referral: '/app/referrals',
  opportunity: '/app/opportunities',
  household: '/app/households',
  agency_partnership: '/app/agencies',
}

function isSecurities(reason: string | null, blockedStep: string | null): boolean {
  return (
    (reason ?? '').toLowerCase().includes('securities') ||
    blockedStep === 'is_security' ||
    blockedStep === 'securities_scope'
  )
}

// AI Escalation Detail (A3). Shows the blocked/judgment context and the human
// resolution controls. Securities items are read-only handoffs to FFS — never sent.
export default async function EscalationDetailPage({ params }: { params: { id: string } }) {
  const res = await load<Escalation | null>(
    (db) =>
      db
        .from('agent_actions')
        .select('id, run_id, kind, actor, outcome, target_type, target_id, reason, blocked_step, note, drafted_content, created_at')
        .eq('id', params.id)
        .eq('kind', 'escalation')
        .maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const e = res.data
  if (!e) notFound()

  const resolved = Boolean(e.outcome && RESOLVED.has(e.outcome))
  const securities = isSecurities(e.reason, e.blocked_step)
  const targetBase = e.target_type ? TARGET_PATH[e.target_type] : undefined
  const targetHref = targetBase && e.target_id ? `${targetBase}/${e.target_id}` : null

  const rail = (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Related</p>
      <ul className="space-y-1.5">
        {targetHref ? (
          <li>
            <Link href={targetHref} className="text-primary hover:underline">
              Open {e.target_type?.replace(/_/g, ' ')}
            </Link>
          </li>
        ) : (
          <li className="text-muted-foreground">No linked record.</li>
        )}
        {e.run_id ? <li className="text-muted-foreground">Agent run <Numeric className="font-mono text-xs">{e.run_id.slice(0, 8)}</Numeric></li> : null}
      </ul>
    </div>
  )

  return (
    <DetailShell
      title={e.reason ?? 'Escalation'}
      description={`Raised ${new Date(e.created_at).toLocaleString('en-US')}`}
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'AI Escalations', href: '/app/ai/escalations' },
        { label: e.reason ?? 'Escalation' },
      ]}
      status={<StatusBadge status={resolved ? 'won' : 'escalated'} label={resolved ? e.outcome ?? 'resolved' : 'escalated'} />}
      actions={securities ? undefined : <EscalationActions id={params.id} resolved={resolved} />}
      rail={rail}
    >
      {securities ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-status-security/40 bg-status-security/10 p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 text-status-security" />
          <div className="space-y-1">
            <p className="font-medium text-status-security">FFS-managed securities item — route to FFS. Cannot be sent from FSOS.</p>
            <p className="text-sm text-muted-foreground">
              This escalation touches securities activity. FSOS is not the system of record and has no send path here —
              handle it through the FFS-supervised channel.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Escalation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Reason" value={e.reason ?? '—'} />
            <Row label="Blocked step" value={e.blocked_step ?? '—'} />
            <Row label="Raised by" value={e.actor ?? 'system'} />
            <Row label="Raised at" value={new Date(e.created_at).toLocaleString('en-US')} />
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Target</span>
              <span className="text-right font-medium">
                {targetHref ? (
                  <Link href={targetHref} className="text-primary hover:underline">
                    {e.target_type} · <Numeric className="font-mono text-xs">{e.target_id?.slice(0, 8)}</Numeric>
                  </Link>
                ) : (
                  e.target_type ?? '—'
                )}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Outcome</span>
              <Badge variant={resolved ? (e.outcome === 'dismissed' ? 'lost' : 'won') : 'escalated'}>
                {resolved ? e.outcome : 'escalated'}
              </Badge>
            </div>
            {e.note ? <Row label="Note" value={e.note} /> : null}
          </CardContent>
        </Card>
      </div>

      {e.drafted_content ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Drafted content</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              {e.drafted_content}
            </p>
            {securities ? null : (
              <p className="mt-2 text-xs text-muted-foreground">
                Draft only. Nothing is sent from this queue — resolving records a decision for the human FSA.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </DetailShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
