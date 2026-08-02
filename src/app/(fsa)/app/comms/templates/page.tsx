import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import { getServerSession } from '@/lib/auth/session'
import { TemplateCreateForm, TemplateBulkTable, type TemplateRow } from '@/components/app/TemplateControls'

export const dynamic = 'force-dynamic'

// OS-12 Templates (A2). Only approved templates are sendable. The list supports bulk
// administration — select multiple → approve / unapprove (approvers only) / delete
// (archive) — via the §8 command-bar pattern. Authority is enforced server-side.
export default async function TemplatesPage() {
  const [templates, session] = await Promise.all([
    load<TemplateRow[]>(
      (db) => db.from('comm_templates').select('id, name, channel, category, approval_status, version').is('archived_at', null).order('updated_at', { ascending: false }),
      [],
    ),
    getServerSession(),
  ])

  const canApprove = !!session && session.roles.some((r) => ['compliance', 'supervisor', 'super_admin'].includes(r))

  return (
    <ListShell title="Templates" description="Pre-approved messages. Unapproved templates cannot be used by any campaign or agent." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Templates' }]}>
      {!templates.ok ? (
        <ErrorState description={templates.kind === 'not_configured' ? 'Database not configured.' : templates.message} />
      ) : (
        <div className="space-y-6">
          {templates.data.length === 0 ? (
            <EmptyState title="No templates yet" description="Create a draft below, then submit it for compliance approval." />
          ) : (
            <TemplateBulkTable templates={templates.data} canApprove={canApprove} />
          )}
          <div className="rounded-lg border p-4">
            <p className="mb-3 text-sm font-medium">New template</p>
            <TemplateCreateForm />
          </div>
        </div>
      )}
    </ListShell>
  )
}
