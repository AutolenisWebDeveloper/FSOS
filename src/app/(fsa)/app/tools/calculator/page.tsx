import { requireRole } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { SalesCalculator } from '@/components/app/SalesCalculator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Sales Calculator (docs/legacy-port.md §2.8) — client-side illustration tools.
// Educational estimates only; every output carries the disclaimer and is framed as
// a gap/estimate, never a product recommendation. Roles: fsa, licensed_staff.
export default async function CalculatorPage() {
  await requireRole('fsa', '/app/tools/calculator')
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales Calculator"
        description="Needs and income illustrations for a review conversation — educational estimates, not recommendations."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Sales Calculator' }]}
      />
      <SalesCalculator />
    </div>
  )
}
