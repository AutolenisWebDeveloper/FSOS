import { Radio, PlugZap, CheckCircle2, CircleSlash } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, StatTile, EmptyState, ErrorState, StatusBadge } from '@/components/archetypes'
import {
  CHANNEL_COLUMNS,
  toChannelView,
  type ChannelRow,
  type ChannelView,
} from '@/lib/social/channels'
import { PLATFORM_LABELS, channelStatusBadge } from '@/lib/social/labels'
import { SOCIAL_PLATFORMS, platformSupport, type SocialPlatform } from '@/lib/social/adapters'
import { ConnectChannel, DisconnectChannel } from './accounts-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function SocialAccountsPage() {
  await requireRole('fsa', '/app/social/accounts')

  const res = await load<ChannelRow[]>(
    (db) =>
      db
        .from('social_channels')
        .select(CHANNEL_COLUMNS)
        .is('deleted_at', null)
        .order('platform', { ascending: true }),
    [],
  )

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Accounts' },
  ]

  if (!res.ok) {
    return (
      <ListShell
        title="Social Accounts"
        description="Connect and monitor the platforms FSOS can publish to."
        breadcrumb={breadcrumb}
        actions={<ConnectChannel />}
      >
        {res.kind === 'not_configured' ? (
          <EmptyState
            icon={PlugZap}
            title="Database not configured"
            description="Set the Supabase environment variables to load connected social accounts."
          />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const channels: ChannelView[] = res.data.map(toChannelView)
  const connected = channels.filter((c) => c.capabilities.configured).length

  return (
    <ListShell
      title="Social Accounts"
      description="Connect and monitor the platforms FSOS can publish to. Tokens are stored encrypted server-side and never exposed to the browser."
      breadcrumb={breadcrumb}
      actions={<ConnectChannel />}
    >
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Connected" value={connected} icon={CheckCircle2} tone="brand" />
        <StatTile label="Registered accounts" value={channels.length} icon={Radio} />
        <StatTile label="Platforms available" value={SOCIAL_PLATFORMS.length} icon={PlugZap} />
      </div>

      <Section title="Connected accounts" description="Accounts registered to this workspace and their live capabilities.">
        {channels.length === 0 ? (
          <EmptyState
            icon={Radio}
            title="No accounts connected yet"
            description="Register a platform account to start drafting and scheduling social content. Publishing activates as each platform's API access is obtained."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {channels.map((c) => (
              <ChannelCard key={c.id} channel={c} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Platform availability"
        description="What each platform's official API allows. Personal-profile posting and browser automation are never supported."
        className="mt-6"
      >
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOCIAL_PLATFORMS.map((p) => (
            <PlatformRosterCard key={p} platform={p} />
          ))}
        </ul>
      </Section>
    </ListShell>
  )
}

function CapabilityChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ' +
        (on
          ? 'border-status-won/30 bg-status-won/10 text-status-won'
          : 'border-shell-border bg-muted/40 text-muted-foreground')
      }
    >
      {on ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <CircleSlash className="h-3 w-3" aria-hidden />}
      <span>{label}</span>
      <span className="sr-only">{on ? 'available' : 'unavailable'}</span>
    </span>
  )
}

function ChannelCard({ channel }: { channel: ChannelView }) {
  const badge = channelStatusBadge(channel.status)
  const caps = channel.capabilities
  return (
    <li className="rounded-lg border border-shell-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{PLATFORM_LABELS[channel.platform]}</p>
          {channel.display_name ? (
            <p className="text-sm text-muted-foreground">{channel.display_name}</p>
          ) : null}
        </div>
        <StatusBadge status={badge.key} label={badge.label} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <CapabilityChip label="Post" on={caps.canPost} />
        <CapabilityChip label="Engagement" on={caps.canReadEngagement} />
        <CapabilityChip label="Analytics" on={caps.canReadAnalytics} />
      </div>

      {!caps.configured && caps.reason ? (
        <p className="mt-3 text-sm text-muted-foreground">{caps.reason}</p>
      ) : null}
      {channel.token_expires_at ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Credential expires {new Date(channel.token_expires_at).toLocaleDateString()}
        </p>
      ) : null}
      {channel.last_error ? (
        <p className="mt-2 text-xs text-status-lost">{channel.last_error}</p>
      ) : null}

      <div className="mt-4">
        <DisconnectChannel id={channel.id} platformLabel={PLATFORM_LABELS[channel.platform]} />
      </div>
    </li>
  )
}

function PlatformRosterCard({ platform }: { platform: SocialPlatform }) {
  const s = platformSupport(platform)
  return (
    <li className="rounded-lg border border-shell-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground">{PLATFORM_LABELS[platform]}</p>
        <StatusBadge
          status={s.active ? 'active' : 'pending'}
          label={s.active ? 'Available' : 'Coming soon'}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CapabilityChip label="Post" on={s.canPost} />
        <CapabilityChip label="Engagement" on={s.canReadEngagement} />
        <CapabilityChip label="Analytics" on={s.canReadAnalytics} />
      </div>
      {!s.active ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Adapter ready — activates once platform API access is obtained.
        </p>
      ) : null}
    </li>
  )
}
