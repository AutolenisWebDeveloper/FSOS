import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { RetryButton } from '@/components/ui/RetryButton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FormulaResultCard } from '@/components/fna/FormulaResultCard'
import { planTypeDef } from '@/lib/fna/plan-types'
import { fmtPercent } from '@/components/fna/value-label'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ResultRow {
  formula_id: string
  formula_version: string
  envelope: Record<string, unknown>
  confidence: string
}

export default async function FnaPlanResultsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}/results`)

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'AI FNA Command Center', href: '/app/fna' },
    { label: 'Plans', href: '/app/fna/plans' },
    { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
    { label: 'Results' },
  ]

  const planRes = await load<{ id: string; plan_type: string; current_version_id: string | null } | null>(
    (db) => db.from('fna_plans').select('id, plan_type, current_version_id').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!planRes.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Results" breadcrumb={breadcrumb} />
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

  const versionRes = await load<{ id: string; version_no: number; inputs_snapshot: { completeness?: number; missingFields?: string[] } | null } | null>(
    (db) => db.from('fna_versions').select('id, version_no, inputs_snapshot').eq('plan_id', params.id).order('version_no', { ascending: false }).limit(1).maybeSingle(),
    null,
  )
  const version = versionRes.ok ? versionRes.data : null

  if (!version) {
    return (
      <div className="space-y-6">
        <PageHeader title="Results" description={planTypeDef(plan.plan_type)?.label ?? plan.plan_type} breadcrumb={breadcrumb} />
        <EmptyState
          title="Not calculated yet"
          description="Enter inputs and calculate to produce traceable results — every figure derived deterministically from a formula."
          action={
            <Button asChild>
              <Link href={`/app/fna/plans/${params.id}/inputs`}>Enter inputs</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const resultsRes = await load<ResultRow[]>(
    (db) => db.from('fna_results').select('formula_id, formula_version, envelope, confidence').eq('version_id', version.id).order('formula_id', { ascending: true }),
    [],
  )
  const results = resultsRes.ok ? resultsRes.data : []
  const completeness = version.inputs_snapshot?.completeness
  const missing = version.inputs_snapshot?.missingFields ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Results — version ${version.version_no}`}
        description="Analysis only. Every figure is Calculated and traces to a formula, its version, the inputs, and the assumptions used. Not a product recommendation."
        breadcrumb={breadcrumb}
        actions={
          <div className="flex items-center gap-2">
            {typeof completeness === 'number' ? <Badge variant={completeness >= 1 ? 'active' : 'draft'}>{fmtPercent(completeness, 0)} complete</Badge> : null}
            <Button asChild variant="outline">
              <Link href={`/app/fna/plans/${params.id}/inputs`}>Edit inputs</Link>
            </Button>
          </div>
        }
      />

      {missing.length > 0 ? (
        <div className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-3 text-sm">
          <p className="font-medium">What&apos;s missing ({missing.length})</p>
          <p className="text-muted-foreground">
            These inputs weren&apos;t supplied, so the affected analyses run at lower confidence: {missing.map((m) => m.replace(/_/g, ' ')).join(', ')}.
          </p>
        </div>
      ) : null}

      {results.length === 0 ? (
        <EmptyState title="No results" description="This version produced no analyses. Add inputs and recalculate." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {results.map((r, i) => (
            <FormulaResultCard key={i} envelope={{ ...(r.envelope as object), confidence: r.confidence } as never} />
          ))}
        </div>
      )}
    </div>
  )
}
