import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { RetryButton } from '@/components/ui/RetryButton'
import { InputsForm } from '@/components/fna/InputsForm'
import { planTypeDef } from '@/lib/fna/plan-types'
import { normalizeInputs } from '@/lib/fna/calculate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function FnaPlanInputsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  await requireRole('fsa', `/app/fna/plans/${params.id}/inputs`)

  const planRes = await load<{ id: string; plan_type: string; title: string | null } | null>(
    (db) => db.from('fna_plans').select('id, plan_type, title').eq('id', params.id).is('deleted_at', null).maybeSingle(),
    null,
  )
  if (!planRes.ok) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Structured intake"
          breadcrumb={[
            { label: 'FSA', href: '/app' },
            { label: 'AI FNA Command Center', href: '/app/fna' },
            { label: 'Plans', href: '/app/fna/plans' },
            { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
            { label: 'Inputs' },
          ]}
        />
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
  const def = planTypeDef(plan.plan_type)

  const inputsRes = await load<Array<{ key: string; value_numeric: number | null; source_label: string | null; created_at: string }>>(
    (db) => db.from('fna_inputs').select('key, value_numeric, source_label, created_at').eq('plan_id', params.id).order('created_at', { ascending: true }),
    [],
  )
  // Show the same deterministic winner the engine will calculate from (highest
  // source authority, then most recent), not whatever row the DB happens to return
  // last — so the form never shows a value the calculation won't use.
  const initial: Record<string, number> = normalizeInputs(inputsRes.ok ? inputsRes.data : [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Structured intake"
        description={`${def?.label ?? plan.plan_type} — enter what you have; save and resume anytime. Nothing blocks on incomplete data.`}
        breadcrumb={[
          { label: 'FSA', href: '/app' },
          { label: 'AI FNA Command Center', href: '/app/fna' },
          { label: 'Plans', href: '/app/fna/plans' },
          { label: 'Workspace', href: `/app/fna/plans/${params.id}` },
          { label: 'Inputs' },
        ]}
      />
      <InputsForm planId={params.id} fields={def?.fields ?? []} initial={initial} />
    </div>
  )
}
