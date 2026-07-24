import Link from 'next/link'
import { Plus, FileText } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, StatTile, EmptyState, ErrorState, StatusBadge } from '@/components/archetypes'
import { Button } from '@/components/ui/button'
import { PLATFORM_LABELS, contentStatusBadge } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Row {
  id: string
  title: string | null
  body: string
  platforms: string[]
  status: string
  campaign_tag: string | null
  author_kind: string
  updated_at: string
}

export default async function SocialContentPage() {
  await requireRole('fsa', '/app/social/content')

  const res = await load<Row[]>(
    (db) =>
      db
        .from('social_content')
        .select('id, title, body, platforms, status, campaign_tag, author_kind, updated_at')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
    [],
  )

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Content' },
  ]
  const actions = (
    <Button asChild size="sm">
      <Link href="/app/social/content/new">
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        New content
      </Link>
    </Button>
  )

  if (!res.ok) {
    return (
      <ListShell title="Social Content" description="Draft, review, and approve social posts." breadcrumb={breadcrumb} actions={actions}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={FileText} title="Database not configured" description="Set the Supabase environment variables to load content." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const rows = res.data
  const inReview = rows.filter((r) => r.status === 'IN_REVIEW').length
  const approved = rows.filter((r) => r.status === 'APPROVED').length

  return (
    <ListShell title="Social Content" description="Draft with AI assistance, then review and approve. Nothing publishes without an approved version." breadcrumb={breadcrumb} actions={actions}>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="All content" value={rows.length} icon={FileText} />
        <StatTile label="Awaiting review" value={inReview} tone={inReview > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Approved" value={approved} tone="brand" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No content yet"
          description="Draft your first post — with AI assistance grounded in your knowledge library — then send it for approval."
          action={
            <Button asChild size="sm">
              <Link href="/app/social/content/new">New content</Link>
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
          {rows.map((r) => {
            const badge = contentStatusBadge(r.status)
            return (
              <li key={r.id}>
                <Link href={`/app/social/content/${r.id}`} className="flex items-start justify-between gap-4 p-4 hover:bg-muted/40">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{r.title || r.body.slice(0, 80) || 'Untitled'}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{r.platforms.map((p) => PLATFORM_LABELS[p as SocialPlatform] ?? p).join(', ') || 'No platform'}</span>
                      {r.campaign_tag ? <span>· {r.campaign_tag}</span> : null}
                      {r.author_kind === 'ai' ? <span>· AI-assisted</span> : null}
                    </p>
                  </div>
                  <StatusBadge status={badge.key} label={badge.label} />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </ListShell>
  )
}
