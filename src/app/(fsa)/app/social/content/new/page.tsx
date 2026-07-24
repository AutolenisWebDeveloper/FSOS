import { requireRole } from '@/lib/auth/session'
import { ListShell } from '@/components/archetypes'
import { DraftEditor } from './draft-editor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function NewSocialContentPage() {
  await requireRole('fsa', '/app/social/content/new')
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
      <DraftEditor />
    </ListShell>
  )
}
