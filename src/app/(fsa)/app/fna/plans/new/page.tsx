import { requireRole } from '@/lib/auth/session'
import { FormShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { NewPlanForm } from '@/components/fna/NewPlanForm'
import { PLAN_TYPES } from '@/lib/fna/plan-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function NewFnaPlanPage() {
  await requireRole('fsa', '/app/fna/plans/new')

  const res = await load<{ id: string; primary_name: string }[]>(
    (db) => db.from('households').select('id, primary_name').is('deleted_at', null).order('primary_name', { ascending: true }),
    [],
  )

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'AI FNA Command Center', href: '/app/fna' },
    { label: 'Plans', href: '/app/fna/plans' },
    { label: 'New' },
  ]

  if (!res.ok) {
    return (
      <FormShell title="Start a plan" breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? <ErrorState title="Database not configured" /> : <ErrorState description={res.message} />}
      </FormShell>
    )
  }

  if (res.data.length === 0) {
    return (
      <FormShell title="Start a plan" breadcrumb={breadcrumb}>
        <EmptyState title="No households yet" description="Add a household from a referral first, then start its plan here." />
      </FormShell>
    )
  }

  return (
    <FormShell
      title="Start a plan"
      description="Pick a plan type and household. Express is the fast path; Comprehensive collects the full picture."
      breadcrumb={breadcrumb}
      onSubmitNote="Inputs and results are validated server-side; every figure traces to a formula and version."
    >
      <NewPlanForm households={res.data} planTypes={PLAN_TYPES.map((p) => ({ id: p.id, label: p.label, description: p.description }))} />
    </FormShell>
  )
}
