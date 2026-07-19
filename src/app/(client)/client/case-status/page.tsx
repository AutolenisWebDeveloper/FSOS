import { ListShell, EmptyState } from '@/components/archetypes'
export const dynamic = 'force-dynamic'
// P-5 Case Status (A3-lite). Non-securities milestones only, where allowed.
export default function ClientCaseStatusPage() {
  return (
    <ListShell title="Case Status" description="Non-securities application milestones only." breadcrumb={[{ label: 'Home', href: '/client' }, { label: 'Case Status' }]}>
      <EmptyState title="No active application" description="When you have an application in progress, its non-securities milestones appear here. Securities case content is never shown in this portal." />
    </ListShell>
  )
}
