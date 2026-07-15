import { notFound } from 'next/navigation'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { load } from '@/lib/data/query'
import { getServerSession } from '@/lib/auth/session'
import { TemplateApprovalControls, TemplateBodyEditor } from '@/components/app/TemplateControls'

export const dynamic = 'force-dynamic'

// OS-12 Template Editor (A5). Approval limited to compliance/supervisor/super.
export default async function TemplateDetailPage({ params }: { params: { id: string } }) {
  const [res, session] = await Promise.all([
    load<{ id: string; name: string; channel: string; category: string | null; body: string; approval_status: string; version: number; approved_by: string | null } | null>(
      (db) => db.from('comm_templates').select('*').eq('id', params.id).maybeSingle(),
      null,
    ),
    getServerSession(),
  ])
  if (!res.ok) return <ErrorState description={res.kind === 'not_configured' ? 'Database not configured.' : res.message} />
  const t = res.data
  if (!t) notFound()

  const canApprove = !!session && session.roles.some((r) => ['compliance', 'supervisor', 'super_admin'].includes(r))

  return (
    <DetailShell
      title={t.name}
      description={`${t.channel} · ${(t.category ?? '').replace(/_/g, ' ')} · v${t.version}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Templates', href: '/app/comms/templates' }, { label: t.name }]}
      status={<span className="flex items-center gap-2"><StatusBadge status={t.approval_status === 'approved' ? 'won' : t.approval_status === 'submitted' ? 'pending' : 'draft'} label={t.approval_status} />{t.channel === 'sms' ? <Badge variant="outline">sms</Badge> : <Badge variant="outline">email</Badge>}</span>}
    >
      <Card>
        <CardHeader><CardTitle className="text-base">Approval</CardTitle></CardHeader>
        <CardContent><TemplateApprovalControls id={t.id} status={t.approval_status} canApprove={canApprove} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Body</CardTitle></CardHeader>
        <CardContent><TemplateBodyEditor id={t.id} body={t.body} /></CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Every template must be education/invitation only, carry an opt-out/consent footer, and pass the recommendation-language block. Term-conversion/cross-sell templates are education/invitation only.</p>
    </DetailShell>
  )
}
