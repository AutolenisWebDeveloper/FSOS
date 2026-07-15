import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { CampaignActivateControls } from '@/components/app/CampaignControls'

export const dynamic = 'force-dynamic'

// OS-12 Campaign Detail (A3). Shows the suppression report (who/why excluded).
export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  const res = await load<{ id: string; name: string; channel: string | null; status: string; template_id: string | null; audience: unknown } | null>(
    (db) => db.from('comm_campaigns').select('*').eq('id', params.id).maybeSingle(),
    null,
  )
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const c = res.data
  if (!c) notFound()

  const [enrollments, template] = await Promise.all([
    load<{ id: string; status: string; suppressed_reason: string | null }[]>((db) => db.from('comm_campaign_enrollments').select('id, status, suppressed_reason').eq('campaign_id', params.id).limit(2000), []),
    c.template_id ? load<{ name: string; approval_status: string } | null>((db) => db.from('comm_templates').select('name, approval_status').eq('id', c.template_id).maybeSingle(), null) : Promise.resolve({ ok: true as const, data: null }),
  ])
  const enr = enrollments.ok ? enrollments.data : []
  const sent = enr.filter((e) => e.status === 'sent').length
  const suppressed = enr.filter((e) => e.status === 'suppressed')
  const suppressionByReason = new Map<string, number>()
  for (const s of suppressed) { const r = s.suppressed_reason ?? 'unknown'; suppressionByReason.set(r, (suppressionByReason.get(r) ?? 0) + 1) }

  return (
    <DetailShell
      title={c.name}
      description={`${c.channel ?? ''} campaign`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Campaigns', href: '/app/comms/campaigns' }, { label: c.name }]}
      status={<StatusBadge status={c.status === 'active' ? 'active' : c.status === 'completed' ? 'won' : c.status === 'paused' ? 'pending' : 'draft'} label={c.status} />}
      actions={<CampaignActivateControls id={c.id} status={c.status} />}
      rail={
        <div className="space-y-3 text-sm">
          <p className="font-medium">Template</p>
          {template.ok && template.data ? (
            <p><Link href={`/app/comms/templates/${c.template_id}`} className="text-primary hover:underline">{template.data.name}</Link> <Badge variant={template.data.approval_status === 'approved' ? 'won' : 'draft'} className="ml-1">{template.data.approval_status}</Badge></p>
          ) : <p className="text-muted-foreground">None</p>}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Enrolled</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{enr.length}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Sent</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-status-won">{sent}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Suppressed</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold text-status-blocked">{suppressed.length}</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Suppression report</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {suppressionByReason.size === 0 ? <p className="text-muted-foreground">No suppressions{c.status === 'draft' ? ' yet — activate to dispatch through the gate.' : '.'}</p> : (
            Array.from(suppressionByReason.entries()).map(([reason, count]) => (
              <div key={reason} className="flex justify-between border-b py-1 last:border-0"><span className="capitalize">{reason.replace(/_/g, ' ')}</span><span className="tabular-nums">{count}</span></div>
            ))
          )}
          <p className="pt-2 text-xs text-muted-foreground">Each send passes the 7-step gate per recipient. Blocked recipients are suppressed with a reason, never silently dropped.</p>
        </CardContent>
      </Card>
    </DetailShell>
  )
}
