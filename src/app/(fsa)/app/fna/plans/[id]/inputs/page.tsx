import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { PageHeader, ErrorState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { InputsForm } from '@/components/fna/InputsForm'
import { planTypeDef } from '@/lib/fna/plan-types'

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
        {planRes.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={planRes.message} />}
      </div>
    )
  }
  if (!planRes.data) notFound()
  const plan = planRes.data
  const def = planTypeDef(plan.plan_type)

  const inputsRes = await load<Array<{ key: string; value_numeric: number | null }>>(
    (db) => db.from('fna_inputs').select('key, value_numeric').eq('plan_id', params.id),
    [],
  )
  const initial: Record<string, number> = {}
  for (const row of inputsRes.ok ? inputsRes.data : []) {
    if (typeof row.value_numeric === 'number') initial[row.key] = row.value_numeric
  }

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
