import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell } from '@/components/archetypes'
import { DraftEditor } from './draft-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface KnowledgeOption {
  id: string
  title: string
}

export default async function NewSocialContentPage() {
  await requireRole('fsa', '/app/social/content/new')

  // Client-safe, published knowledge articles the drafter can ground a post on.
  const articles = await load<KnowledgeOption[]>(
    (db) =>
      db
        .from('knowledge_documents')
        .select('id, title')
        .eq('status', 'published')
        .eq('visibility', 'client_safe')
        .order('updated_at', { ascending: false })
        .limit(100),
    [],
  )

  return (
    <ListShell
      title="New content"
      description="Draft a post — with optional AI assistance grounded in your knowledge library — then send it for approval. The AI never publishes."
      breadcrumb={[
        { label: 'FSA', href: '/app' },
        { label: 'Social', href: '/app/social' },
        { label: 'Content', href: '/app/social/content' },
        { label: 'New' },
      ]}
    >
      <DraftEditor knowledgeArticles={articles.ok ? articles.data : []} />
    </ListShell>
  )
}
