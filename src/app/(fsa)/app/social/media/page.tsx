import { ImageIcon, Film, Images } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { listMediaAssets } from '@/lib/social/media-service'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'
import { MediaUploader, DeleteAsset, AssetThumb } from './media-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export default async function SocialMediaPage() {
  await requireRole('fsa', '/app/social/media')

  const res = await listMediaAssets()
  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Media' },
  ]

  if (!res.ok) {
    return (
      <ListShell title="Media library" description="Reusable images and video for your posts." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={Images} title="Database not configured" description="Set the Supabase environment variables to load the media library." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const assets = res.data
  const images = assets.filter((a) => a.kind === 'image').length
  const videos = assets.filter((a) => a.kind === 'video').length

  return (
    <ListShell
      title="Media library"
      description="Reusable images and video for your posts. Files are stored privately and reused across drafts; per-platform compatibility is checked for each asset."
      breadcrumb={breadcrumb}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Assets" value={assets.length} icon={Images} tone="brand" />
        <StatTile label="Images" value={images} icon={ImageIcon} />
        <StatTile label="Videos" value={videos} icon={Film} />
      </div>

      <div className="mb-6">
        <MediaUploader />
      </div>

      <Section title="Assets" description="Every asset shows the platforms it can publish to and how many times it's been used.">
        {assets.length === 0 ? (
          <EmptyState
            icon={Images}
            title="No assets yet"
            description="Upload an image or video above to reuse it across your social posts."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((a) => (
              <li key={a.id} className="rounded-lg border border-shell-border bg-card p-3">
                <AssetThumb kind={a.kind} url={a.preview_url} alt={a.alt_text || a.file_name} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={a.file_name}>
                      {a.file_name}
                    </p>
                    <p className="numeric text-xs text-muted-foreground">
                      {a.kind === 'image' && a.width && a.height ? `${a.width}×${a.height} · ` : ''}
                      {a.kind === 'video' && a.duration_seconds ? `${Math.round(a.duration_seconds)}s · ` : ''}
                      {formatBytes(a.byte_size)} · used {a.usage_count}×
                    </p>
                  </div>
                  <DeleteAsset id={a.id} fileName={a.file_name} />
                </div>
                {a.alt_text ? <p className="mt-1 truncate text-xs text-muted-foreground" title={a.alt_text}>Alt: {a.alt_text}</p> : (
                  <p className="mt-1 text-xs text-status-lost">No alt text — add one for accessibility.</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.compatibility.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No platform accepts this asset as-is.</span>
                  ) : (
                    a.compatibility.map((p) => (
                      <span key={p} className="rounded-md border border-status-won/30 bg-status-won/10 px-1.5 py-0.5 text-[11px] font-medium text-status-won">
                        {PLATFORM_LABELS[p as SocialPlatform]}
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ListShell>
  )
}
