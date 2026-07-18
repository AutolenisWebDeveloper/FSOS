import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
import { KnowledgeCreateForm } from '@/components/app/KnowledgeControls'

export const dynamic = 'force-dynamic'

// AI Knowledge Library. A centralized, indexed store of documents, FAQs, policies,
// procedures, templates, and business info the AI retrieves from when responding to
// a contact. Farmers-specific facts carry a "config default — verify" badge and are
// never asserted by the AI as fact.
interface Doc {
  id: string
  title: string
  kind: string
  category: string | null
  summary: string | null
  tags: string[] | null
  status: string
  is_assumption: boolean
  visibility: string
  usage_count: number
  updated_at: string
}

export default async function KnowledgeLibraryPage() {
  const docs = await load<Doc[]>(
    (db) =>
      db
        .from('knowledge_documents')
        .select('id, title, kind, category, summary, tags, status, is_assumption, visibility, usage_count, updated_at')
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(300),
    [],
  )

  return (
    <ListShell
      title="AI Knowledge Library"
      description="Documents, FAQs, policies, procedures, templates, and business info the AI retrieves from when responding to contacts."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Knowledge Library' }]}
      actions={<KnowledgeCreateForm />}
    >
      {!docs.ok ? (
        <ErrorState description={docs.kind === 'not_configured' ? 'Database not configured.' : docs.message} />
      ) : docs.data.length === 0 ? (
        <EmptyState title="No knowledge yet" description="Add documents, FAQs, policies, procedures, or templates the AI should use." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.title}</div>
                    {d.summary ? <div className="max-w-md truncate text-xs text-muted-foreground">{d.summary}</div> : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.status !== 'published' ? <Badge variant="pending">{d.status}</Badge> : null}
                      {d.visibility === 'client_safe' ? <Badge variant="outline">client-safe</Badge> : null}
                      {d.is_assumption ? <Badge variant="assumption">config default — verify</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{d.kind.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{d.category ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{(d.tags ?? []).slice(0, 4).join(', ') || '—'}</TableCell>
                  <TableCell><Numeric>{d.usage_count}</Numeric></TableCell>
                  <TableCell className="text-muted-foreground"><Numeric>{new Date(d.updated_at).toLocaleDateString('en-US')}</Numeric></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}
