import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { DetailShell, ErrorState, Section } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PlanWorkspaceActions } from '@/components/fna/PlanWorkspaceActions'
import { planTypeDef } from '@/lib/fna/plan-types'
import { fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlanDetail {
  id: string
  plan_type: string
  status: string
  title: string | null
  household_id: string
  current_version_id: string | null
  updated_at: string
  households: { primary_name: string } | { primary_name: string }[] | null
}
interface VersionRow {
  id: string
  version_no: number
  status: string
  engine_version: string
  assumption_set_version: string
  inputs_snapshot: { completeness?: number; missingFields?: string[] } | null
  created_at: string
}

const STATUS_TONE: Record<string, 'active' | 'draft' | 'outline'> = {
  APPROVED: 'active',
  CALCULATED: 'active',
  UNDER_REVIEW: 'draft',
  IN_PROGRESS: 'draft',
  DRAFT: 'outline',
}

export default async function FnaPlanWorkspacePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}`)

  const planRes = await load<PlanDetail | null>(
    (db) =>
      db
        .from('fna_plans')
        .select('id, plan_type, status, title, household_id, current_version_id, updated_at, households(primary_name)')
        .eq('id', params.id)
        .is('deleted_at', null)
        .maybeSingle(),
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
  const plan = planRes.data

  const versionRes = await load<VersionRow[]>(
    (db) => db.from('fna_versions').select('id, version_no, status, engine_version, assumption_set_version, inputs_snapshot, created_at').eq('plan_id', params.id).order('version_no', { ascending: false }).limit(5),
    [],
  )
  const versions = versionRes.ok ? versionRes.data : []
  const latest = versions[0] ?? null
  const hh = Array.isArray(plan.households) ? plan.households[0] : plan.households
  const completeness = latest?.inputs_snapshot?.completeness

  return (
    <DetailShell
      title={plan.title || hh?.primary_name || 'Plan'}
      description={`${planTypeDef(plan.plan_type)?.label ?? plan.plan_type}${hh?.primary_name ? ` · ${hh.primary_name}` : ''}`}
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'AI FNA Command Center', href: '/app/fna' }, { label: 'Plans', href: '/app/fna/plans' }, { label: 'Workspace' }]}
      status={<Badge variant={STATUS_TONE[plan.status] ?? 'outline'}>{plan.status.replace(/_/g, ' ')}</Badge>}
      actions={<PlanWorkspaceActions planId={plan.id} />}
      rail={
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Household</p>
            <Link href={`/app/households/${plan.household_id}`} className="text-primary hover:underline">
              {hh?.primary_name ?? 'View household'}
            </Link>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick links</p>
            <ul className="space-y-1">
              <li><Link href={`/app/fna/plans/${plan.id}/inputs`} className="text-primary hover:underline">Inputs</Link></li>
              <li><Link href={`/app/fna/plans/${plan.id}/results`} className="text-primary hover:underline">Results</Link></li>
              <li><Link href={`/app/fna/plans/${plan.id}/scenarios`} className="text-primary hover:underline">Scenarios</Link></li>
              <li><Link href={`/app/fna/plans/${plan.id}/report`} className="text-primary hover:underline">Report</Link></li>
              <li><Link href={`/app/fna/plans/${plan.id}/audit`} className="text-primary hover:underline">Audit trail</Link></li>
              <li><Link href="/app/fna/assumptions" className="text-primary hover:underline">Assumptions</Link></li>
            </ul>
          </div>
        </div>
      }
    >
      <Section title="Planning status" description="A plan is calculated deterministically; each calculation freezes an immutable, reproducible version.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Completeness</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{typeof completeness === 'number' ? fmtPercent(completeness, 0) : '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Share of expected inputs supplied</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest version</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{latest ? `v${latest.version_no}` : '—'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{latest ? `engine ${latest.engine_version}` : 'Not yet calculated'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assumptions</p>
              <p className="mt-1 text-2xl font-semibold">{latest?.assumption_set_version ?? 'default-v1'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Pinned set — config defaults</p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Version history" description="Immutable snapshots — nothing overwrites history.">
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet. Enter inputs, then Calculate to freeze the first version.</p>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">Version {v.version_no}</p>
                      <p className="text-xs text-muted-foreground">
                        engine {v.engine_version} · assumptions {v.assumption_set_version} · {new Date(v.created_at).toLocaleString('en-US')}
                      </p>
                    </div>
                    <Badge variant={STATUS_TONE[v.status] ?? 'outline'}>{v.status.replace(/_/g, ' ')}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </Section>
    </DetailShell>
  )
}
