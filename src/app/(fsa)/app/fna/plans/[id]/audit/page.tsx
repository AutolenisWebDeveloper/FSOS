import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface AuditRow {
  actor: string
  action: string
  entity: string
  entity_id: string | null
  diff: Record<string, unknown> | null
  at: string
}

const EVENT_LABEL: Record<string, string> = {
  'fna.plan.created': 'Plan created',
  'fna.inputs.saved': 'Inputs saved',
  'fna.inputs.prefilled': 'Prefilled from household',
  'fna.plan.calculated': 'Calculated a version',
  'fna.version.snapshot': 'Narrative snapshot version',
}

// Plan audit trail (build instruction §4). Who changed what, when, and which
// version resulted — from the append-only audit_log. Roles: fsa, licensed_staff.
export default async function FnaPlanAuditPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}/audit`)

  const planRes = await load<{ id: string; title: string | null } | null>(
    (db) => db.from('fna_plans').select('id, title').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!planRes.ok) {
    return (
      <div className="space-y-6">
        {planRes.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={planRes.message} />}
      </div>
    )
  }
  if (!planRes.data) notFound()

  const [planEvents, versionEvents] = await Promise.all([
    load<AuditRow[]>((db) => db.from('audit_log').select('actor, action, entity, entity_id, diff, at').eq('entity_id', params.id).order('at', { ascending: false }).limit(100), []),
    load<AuditRow[]>((db) => db.from('audit_log').select('actor, action, entity, entity_id, diff, at').filter('diff->>plan_id', 'eq', params.id).order('at', { ascending: false }).limit(100), []),
  ])

  const seen = new Set<string>()
  const merged: AuditRow[] = []
  for (const r of [...(planEvents.ok ? planEvents.data : []), ...(versionEvents.ok ? versionEvents.data : [])]) {
    const k = `${r.at}|${r.action}|${r.entity_id}`
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(r)
  }
  merged.sort((a, b) => (a.at < b.at ? 1 : -1))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit trail"
        description="Every change to this plan and its versions — attributable, timestamped, and append-only."
        breadcrumb={[
          { label: 'FSA', href: '/app' },
          { label: 'AI FNA Command Center', href: '/app/fna' },
          { label: 'Plans', href: '/app/fna/plans' },
          { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
          { label: 'Audit' },
        ]}
      />
      {merged.length === 0 ? (
        <EmptyState title="No audit events yet" description="Creating, editing, prefilling, or calculating this plan records an append-only audit event here." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {merged.map((r, i) => {
                const event = (r.diff?.event as string) ?? r.action
                return (
                  <li key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">{EVENT_LABEL[event] ?? event}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.actor}
                        {typeof r.diff?.version_no === 'number' ? ` · v${r.diff.version_no}` : ''}
                        {typeof r.diff?.written === 'number' ? ` · ${r.diff.written} value(s)` : ''}
                        {typeof r.diff?.completeness === 'number' ? ` · ${Math.round((r.diff.completeness as number) * 100)}% complete` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{r.entity.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(r.at).toLocaleString('en-US')}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
