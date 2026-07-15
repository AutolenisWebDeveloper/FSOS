import Link from 'next/link'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { TemplateCreateForm } from '@/components/app/TemplateControls'

export const dynamic = 'force-dynamic'

// OS-12 Templates (A2). Only approved templates are sendable.
export default async function TemplatesPage() {
  const templates = await load<{ id: string; name: string; channel: string; category: string | null; approval_status: string; version: number }[]>(
    (db) => db.from('comm_templates').select('id, name, channel, category, approval_status, version').is('archived_at', null).order('updated_at', { ascending: false }),
    [],
  )

  return (
    <ListShell title="Templates" description="Pre-approved messages. Unapproved templates cannot be used by any campaign or agent." breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Comms', href: '/app/comms' }, { label: 'Templates' }]}>
      {!templates.ok ? (
        <ErrorState description={templates.kind === 'not_configured' ? 'Database not configured.' : templates.message} />
      ) : (
        <div className="space-y-6">
          {templates.data.length === 0 ? (
            <EmptyState title="No templates yet" description="Create a draft below, then submit it for compliance approval." />
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Channel</TableHead><TableHead>Category</TableHead><TableHead>Version</TableHead><TableHead>Approval</TableHead></TableRow></TableHeader>
                <TableBody>
                  {templates.data.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell><Link href={`/app/comms/templates/${t.id}`} className="font-medium text-primary hover:underline">{t.name}</Link></TableCell>
                      <TableCell><Badge variant="outline">{t.channel}</Badge></TableCell>
                      <TableCell className="capitalize text-muted-foreground">{(t.category ?? '').replace(/_/g, ' ')}</TableCell>
                      <TableCell>v{t.version}</TableCell>
                      <TableCell><Badge variant={t.approval_status === 'approved' ? 'won' : t.approval_status === 'submitted' ? 'pending' : 'draft'}>{t.approval_status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
