import { requireRole } from '@/lib/auth/session'
import { PageHeader } from '@/components/archetypes'
import { AssistantConsole } from '@/components/app/AssistantConsole'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Assistant page (ports the legacy AI Assistant chat). Every turn routes
// through lib/ai/gateway.ts, is screened by the guardrail's recommendation
// detector, and is logged to agent_runs/agent_actions. Roles: fsa,
// licensed_staff, super_admin (portal-gated by the (fsa) layout).
export default async function AssistantPage() {
  await requireRole('fsa', '/app/assistant')
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="AI Assistant"
        description="An internal operating assistant. It explains FSOS, summarizes records, and drafts internal notes — it never recommends a product."
        breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Assistant' }]}
      />
      <AssistantConsole />
    </div>
  )
}
