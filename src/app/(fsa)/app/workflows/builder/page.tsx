import { FormShell } from '@/components/archetypes'
import { WorkflowBuilder } from '@/components/app/WorkflowBuilder'

export const dynamic = 'force-dynamic'

// OS-14 Workflow Builder (A5/A6 FormShell).
export default function WorkflowBuilderPage() {
  return (
    <FormShell
      title="Workflow Builder"
      description="Define a trigger, optional conditions, ordered steps, and a failure policy."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Workflows', href: '/app/workflows' }, { label: 'Builder' }]}
      onSubmitNote="Validated by the same Zod schema on client and server. Comm-sending steps still pass the comms dispatcher gate."
    >
      <WorkflowBuilder />
    </FormShell>
  )
}
