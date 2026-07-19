import { FormShell } from '@/components/archetypes'
import { DashboardBuilder } from '@/components/app/DashboardBuilder'

export const dynamic = 'force-dynamic'

// OS-01 Custom dashboard builder (A5/A1 FormShell body).
export default function DashboardBuilderPage() {
  return (
    <FormShell
      title="Dashboard builder"
      description="Name a dashboard and choose an ordered set of widgets. Each widget renders live from your data — no drift."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Dashboards', href: '/app/dashboards' }, { label: 'Builder' }]}
      onSubmitNote="Validated by DashboardCreateSchema (Zod) on both the client and the server. Widgets are limited to the analytics catalog."
    >
      <DashboardBuilder />
    </FormShell>
  )
}
