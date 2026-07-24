import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { DetailShell, ErrorState, StatusBadge } from '@/components/archetypes'
import { PLATFORM_LABELS, contentStatusBadge } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'
import { ContentReviewActions } from './review-actions'
import { ScheduleControl } from './schedule-control'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Content {
  id: string
  title: string | null
  body: string
  platforms: string[]
  status: string
  campaign_tag: string | null
  link: string | null
  author_kind: string
  current_version_id: string | null
  is_security: boolean
  updated_at: string
}
interface Version {
  id: string
  version_no: number
  status: string
  snapshot: { body?: string }
  created_by: string | null
  created_at: string
}

export default async function SocialContentDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  await requireRole('fsa', `/app/social/content/${id}`)

  const [contentRes, versionsRes] = await Promise.all([
    load<Content | null>(
      (db) =>
        db
          .from('social_content')
          .select('id, title, body, platforms, status, campaign_tag, link, author_kind, current_version_id, is_security, updated_at')
          .eq('id', id)
          .is('deleted_at', null)
          .maybeSingle(),
      null,
    ),
    load<Version[]>(
      (db) => db.from('social_content_versions').select('id, version_no, status, snapshot, created_by, created_at').eq('content_id', id).order('version_no', { ascending: false }),
      [],
    ),
  ])

  const channelsRes = await load<{ id: string; platform: string; display_name: string | null; status: string }[]>(
    (db) => db.from('social_channels').select('id, platform, display_name, status').is('deleted_at', null).order('platform', { ascending: true }),
    [],
  )

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Content', href: '/app/social/content' },
    { label: 'Review' },
  ]

  if (!contentRes.ok) {
    return (
      <DetailShell title="Content" breadcrumb={breadcrumb}>
        <ErrorState description={contentRes.kind === 'not_configured' ? 'Database not configured.' : contentRes.message} />
      </DetailShell>
    )
  }
  const content = contentRes.data
  if (!content) notFound()

  const versions = versionsRes.ok ? versionsRes.data : []
  const badge = contentStatusBadge(content.status)

  return (
    <DetailShell
      title={content.title || 'Untitled content'}
      description={content.platforms.map((p) => PLATFORM_LABELS[p as SocialPlatform] ?? p).join(', ')}
      breadcrumb={breadcrumb}
      status={<StatusBadge status={badge.key} label={badge.label} />}
    >
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-shell-border bg-card p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Current content</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{content.body}</p>
            {content.link ? (
              <p className="mt-2 truncate text-xs text-primary">{content.link}</p>
            ) : null}
            {content.campaign_tag ? <p className="mt-2 text-xs text-muted-foreground">Campaign: {content.campaign_tag}</p> : null}
            {content.author_kind === 'ai' ? <p className="mt-1 text-xs text-muted-foreground">AI-assisted draft</p> : null}
          </div>

          <ContentReviewActions
            id={content.id}
            status={content.status}
            currentVersionId={content.current_version_id}
          />

          {(content.status === 'APPROVED' || content.status === 'SCHEDULED') && content.current_version_id ? (
            <ScheduleControl
              versionId={content.current_version_id}
              channels={(channelsRes.ok ? channelsRes.data : []).map((c) => ({
                id: c.id,
                label: (PLATFORM_LABELS[c.platform as SocialPlatform] ?? c.platform) + (c.display_name ? ` · ${c.display_name}` : ''),
                connected: c.status === 'connected',
              }))}
            />
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-foreground">Version history</p>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No frozen versions yet. Submitting for review freezes an immutable snapshot.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const vb = contentStatusBadge(v.status)
                return (
                  <li key={v.id} className="rounded-md border border-shell-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">v{v.version_no}</span>
                      <StatusBadge status={vb.key} label={v.status} />
                    </div>
                    {v.snapshot?.body ? (
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{v.snapshot.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {new Date(v.created_at).toLocaleString()} {v.created_by ? `· ${v.created_by}` : ''}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </DetailShell>
  )
}
