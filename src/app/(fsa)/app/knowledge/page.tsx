import Link from 'next/link'
import { Paperclip } from 'lucide-react'
import { ListShell, ErrorState, EmptyState } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { load, loadCount } from '@/lib/data/query'
import { Numeric } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { KnowledgeToolbar, KnowledgeRowActions } from '@/components/app/KnowledgeControls'

export const dynamic = 'force-dynamic'

// AI Knowledge Library. A centralized, indexed store of documents, FAQs, policies,
// procedures, templates, and business info the AI retrieves from when responding to
// a contact. Knowledge arrives two ways — an uploaded file (original stored privately,
// text extracted and indexed) or text written directly — and every document can be
// edited, archived, restored, or permanently deleted from this page.
//
// Farmers-specific facts carry a "config default — verify" badge and are never
// asserted by the AI as fact (§4.3).
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
  file_name: string | null
  page_count: number | null
  low_confidence: boolean | null
}

// `storage_path` is deliberately not selected: the private bucket path never reaches
// the browser. Downloads go through GET /api/knowledge/[id], which mints a signed URL.
const COLUMNS =
  'id, title, kind, category, summary, tags, status, is_assumption, visibility, usage_count, updated_at, ' +
  'file_name, page_count, low_confidence'

export default async function KnowledgeLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view } = await searchParams
  const showArchived = view === 'archived'

  const docs = await load<Doc[]>((db) => {
    const builder = db.from('knowledge_documents').select(COLUMNS)
    // Active: most recently edited first. Archived: most recently archived first —
    // "when did this leave the library" is the question that view answers, and it is
    // stable under a later edit. `archived_at` is stamped on every archive transition
    // and backfilled by migration 102, so it is non-null for every archived row.
    return (
      showArchived
        ? builder.eq('status', 'archived').order('archived_at', { ascending: false, nullsFirst: false })
        : builder.neq('status', 'archived').order('updated_at', { ascending: false })
    ).limit(300)
  }, [])

  // head:true — the tab only needs "how many", not the rows.
  const archivedTotal = await loadCount((db) =>
    db.from('knowledge_documents').select('id', { count: 'exact', head: true }).eq('status', 'archived'),
  )

  return (
    <ListShell
      title="AI Knowledge Library"
      description="Documents, FAQs, policies, procedures, templates, and business info the AI retrieves from when responding to contacts."
      breadcrumb={[{ label: 'FSA', href: '/app' }, { label: 'Knowledge Library' }]}
      actions={<KnowledgeToolbar />}
      toolbar={
        <nav aria-label="Library view" className="flex items-center gap-1.5 text-sm">
          <ViewTab href="/app/knowledge" label="Active" active={!showArchived} />
          <ViewTab
            href="/app/knowledge?view=archived"
            label="Archived"
            count={archivedTotal}
            active={showArchived}
          />
        </nav>
      }
    >
      {!docs.ok ? (
        <ErrorState description={docs.kind === 'not_configured' ? 'Database not configured.' : docs.message} />
      ) : docs.data.length === 0 ? (
        showArchived ? (
          <EmptyState
            title="Nothing archived"
            description="Archived documents are kept here so you can restore them. None have been archived yet."
          />
        ) : (
          <EmptyState
            title="No knowledge yet"
            description="Upload a document the AI should learn from, or write one directly — policies, FAQs, procedures, or templates."
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <caption className="sr-only">
              {showArchived ? 'Archived knowledge documents' : 'Active knowledge documents'}
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.title}</div>
                    {d.summary ? <div className="max-w-md truncate text-xs text-muted-foreground">{d.summary}</div> : null}
                    {d.file_name ? (
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" aria-hidden />
                        <span className="max-w-xs truncate">{d.file_name}</span>
                        {d.page_count ? <span>· {d.page_count}p</span> : null}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.status !== 'published' ? <Badge variant="pending">{d.status}</Badge> : null}
                      {d.visibility === 'client_safe' ? <Badge variant="outline">client-safe</Badge> : null}
                      {d.is_assumption ? <Badge variant="assumption">config default — verify</Badge> : null}
                      {d.low_confidence ? <Badge variant="pending">text unclear — check</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.kind.replace(/_/g, ' ')}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.category ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(d.tags ?? []).slice(0, 4).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Numeric>{d.usage_count}</Numeric>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Numeric>{new Date(d.updated_at).toLocaleDateString('en-US')}</Numeric>
                  </TableCell>
                  <TableCell className="text-right">
                    <KnowledgeRowActions
                      doc={{
                        id: d.id,
                        title: d.title,
                        kind: d.kind,
                        category: d.category,
                        summary: d.summary,
                        tags: d.tags,
                        status: d.status,
                        visibility: d.visibility,
                        is_assumption: d.is_assumption,
                        file_name: d.file_name,
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListShell>
  )
}

/**
 * Active/Archived switch. A real link (not `useState`), so the view is deep-linkable
 * and survives a refresh — DESIGN.md §12/§30. Styling matches the saved-view filter
 * rail used on the book of business, so the two read as the same control.
 */
function ViewTab({
  href,
  label,
  active,
  count,
}: {
  href: string
  label: string
  active: boolean
  count?: number
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors',
        active ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {count ? <span className="tabular-nums text-xs text-muted-foreground">{count}</span> : null}
    </Link>
  )
}
