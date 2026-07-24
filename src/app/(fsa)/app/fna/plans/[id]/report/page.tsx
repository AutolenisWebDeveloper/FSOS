import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load, unwrapOne } from '@/lib/data/query'
import { RetryButton } from '@/components/ui/RetryButton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReportActions } from '@/components/fna/ReportActions'
import { buildReportSections, REPORT_DISCLOSURE, type ReportResultInput } from '@/lib/fna/report'
import { planTypeDef } from '@/lib/fna/plan-types'
import { ConfidenceBadge } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function FnaPlanReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}/report`)

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'AI FNA Command Center', href: '/app/fna' },
    { label: 'Plans', href: '/app/fna/plans' },
    { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
    { label: 'Report' },
  ]

  const planRes = await load<{ id: string; plan_type: string; status: string; current_version_id: string | null; households: { primary_name: string } | { primary_name: string }[] | null } | null>(
    (db) => db.from('fna_plans').select('id, plan_type, status, current_version_id, households(primary_name)').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!planRes.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report" breadcrumb={breadcrumb} />
        {planRes.kind === 'not_configured' ? (
          <ErrorState title="Database not configured" />
        ) : (
          <div className="space-y-3">
            <ErrorState description={planRes.message} />
            <RetryButton />
          </div>
        )}
      </div>
    )
  }
  if (!planRes.data) notFound()
  const plan = planRes.data
  const hh = unwrapOne(plan.households)
  const approved = plan.status === 'APPROVED'

  if (!plan.current_version_id) {
    return (
      <div className="space-y-6">
        <PageHeader title="Report" description={planTypeDef(plan.plan_type)?.label ?? plan.plan_type} breadcrumb={breadcrumb} />
        <EmptyState
          title="Nothing to report yet"
          description="Calculate the plan first — a report is generated from an approved, frozen version."
          action={
            <Button asChild>
              <Link href={`/app/fna/plans/${params.id}/inputs`}>Enter inputs</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const [versionRes, resultsRes] = await Promise.all([
    load<{ version_no: number; engine_version: string; assumption_set_version: string } | null>(
      (db) => db.from('fna_versions').select('version_no, engine_version, assumption_set_version').eq('id', plan.current_version_id!).maybeSingle(),
      null,
    ),
    load<ReportResultInput[]>((db) => db.from('fna_results').select('formula_id, formula_version, envelope, confidence').eq('version_id', plan.current_version_id!).order('formula_id', { ascending: true }), []),
  ])
  const version = versionRes.ok ? versionRes.data : null
  const sections = buildReportSections(resultsRes.ok ? resultsRes.data : [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial Needs Analysis report"
        description={`${hh?.primary_name ?? 'Household'} · ${planTypeDef(plan.plan_type)?.label ?? plan.plan_type} · version ${version?.version_no ?? ''}`}
        breadcrumb={breadcrumb}
        actions={<ReportActions planId={params.id} approved={approved} />}
      />

      {!approved ? (
        <div role="status" className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-4 text-sm">
          <p className="font-medium">Draft — not approved</p>
          <p className="text-muted-foreground">Only an approved version may be presented to a client. Approve to unlock the PDF and Excel exports.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Badge variant="active">Approved</Badge>
          <span className="text-xs text-muted-foreground">Presentable to a client. Every figure below traces to its formula and version.</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map((sec) => (
          <Card key={sec.formulaId}>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">{sec.label}</CardTitle>
              <ConfidenceBadge confidence={sec.confidence as 'high' | 'medium' | 'low'} />
            </CardHeader>
            <CardContent className="space-y-3">
              <table className="w-full text-sm">
                <tbody>
                  {sec.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5 pr-4 text-muted-foreground">{r.label}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sec.assumptions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sec.assumptions.map((a, i) => (
                    <Badge key={i} variant="assumption">{a.label}: {a.value}</Badge>
                  ))}
                </div>
              ) : null}
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono">{sec.formulaId}@{sec.version}</span>
                {sec.missing.length > 0 ? ` · missing: ${sec.missing.join(', ')}` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p>{REPORT_DISCLOSURE}</p>
      </div>
    </div>
  )
}
