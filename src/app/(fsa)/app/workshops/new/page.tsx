import { requireRole } from '@/lib/auth/session'
import { FormShell } from '@/components/archetypes'
import { WorkshopForm } from '@/components/app/WorkshopForm'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Create a workshop (docs/legacy-port.md §2.5) — A5.
export default async function NewWorkshopPage() {
  await requireRole('fsa', '/app/workshops/new')
  return (
    <FormShell
      title="New Workshop"
      description="Create an educational seminar. Publish it to open public registration."
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Workshops', href: '/app/workshops' },
        { label: 'New' },
      ]}
      onSubmitNote="Validated with the same Zod schema on the client and server."
    >
      <WorkshopForm />
    </FormShell>
  )
}
