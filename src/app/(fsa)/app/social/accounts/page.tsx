import Link from 'next/link'
import { Radio, PlugZap, CheckCircle2, CircleSlash, AlertTriangle, Link2 } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, StatTile, EmptyState, ErrorState, StatusBadge } from '@/components/archetypes'
import { cn } from '@/lib/utils'
import {
  CHANNEL_COLUMNS,
  toChannelView,
  type ChannelRow,
  type ChannelView,
} from '@/lib/social/channels'
import { PLATFORM_LABELS, channelStatusBadge } from '@/lib/social/labels'
import { SOCIAL_PLATFORMS, platformSupport, type SocialPlatform } from '@/lib/social/adapters'
import { isOAuthPlatform, providerConfig, type OAuthPlatform } from '@/lib/social/oauth'
import { VerifyChannel, DisconnectChannel } from './accounts-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Public (secret-free) view of each platform's OAuth configuration for this env.
type OAuthUi = { configured: boolean; reason?: string }

const connectClasses =
  'inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
const reconnectClasses =
  'inline-flex items-center gap-1 rounded-md border border-shell-border px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted'

function ConnectLink({ platform, label, reconnect = false }: { platform: OAuthPlatform; label: string; reconnect?: boolean }) {
  return (
    <a href={`/api/social/oauth/${platform}/start`} className={reconnect ? reconnectClasses : connectClasses}>
      <Link2 className="h-4 w-4" aria-hidden />
      {reconnect ? 'Reconnect' : `Connect ${label}`}
    </a>
  )
}

function connectBanner(sp: Record<string, string | string[] | undefined>): { tone: 'success' | 'warning' | 'error'; message: string } | null {
  const platform = typeof sp.platform === 'string' ? sp.platform : undefined
  const label = platform && platform in PLATFORM_LABELS ? PLATFORM_LABELS[platform as SocialPlatform] : 'the account'
  const connected = typeof sp.connected === 'string' ? sp.connected : undefined
  if (connected) {
    const cl = connected in PLATFORM_LABELS ? PLATFORM_LABELS[connected as SocialPlatform] : 'the account'
    return { tone: 'success', message: `${cl} connected. Publishing is now enabled for this account.` }
  }
  const connect = typeof sp.connect === 'string' ? sp.connect : undefined
  switch (connect) {
    case 'not_configured':
      return { tone: 'warning', message: `${label} OAuth is not configured for this environment. Set the provider credentials to enable connecting.` }
    case 'denied':
      return { tone: 'warning', message: 'Connection cancelled — consent was not granted.' }
    case 'invalid_state':
      return { tone: 'error', message: 'The connection request expired or could not be verified. Please start again.' }
    case 'unsupported':
      return { tone: 'warning', message: `${label} does not support OAuth connection yet.` }
    case 'error':
      return { tone: 'error', message: `We couldn't complete the ${label} connection. Please try again.` }
    default:
      return null
  }
}

export default async function SocialAccountsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('fsa', '/app/social/accounts')
  const sp = await props.searchParams
  const banner = connectBanner(sp)

  const res = await load<ChannelRow[]>(
    (db) =>
      db
        .from('social_channels')
        .select(CHANNEL_COLUMNS)
        .is('deleted_at', null)
        .order('platform', { ascending: true }),
    [],
  )

  // OAuth configuration per platform (server-side; secret-free).
  const oauthUi: Partial<Record<SocialPlatform, OAuthUi>> = {}
  for (const p of SOCIAL_PLATFORMS) {
    if (isOAuthPlatform(p)) {
      const c = providerConfig(p)
      oauthUi[p] = { configured: c.configured, reason: c.reason }
    }
  }

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
      >
        {banner ? <ConnectBanner {...banner} /> : null}
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
      description="Connect and monitor the platforms FSOS can publish to. Tokens are encrypted at rest server-side and never exposed to the browser."
      breadcrumb={breadcrumb}
    >
      {banner ? <ConnectBanner {...banner} /> : null}

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
            description="Connect a YouTube channel or Facebook Page below to start publishing. Other platforms activate as their API access is obtained."
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
            <PlatformRosterCard key={p} platform={p} oauth={oauthUi[p]} />
          ))}
        </ul>
      </Section>
    </ListShell>
  )
}

function ConnectBanner({ tone, message }: { tone: 'success' | 'warning' | 'error'; message: string }) {
  const styles =
    tone === 'success'
      ? 'border-status-won/30 bg-status-won/10 text-status-won'
      : tone === 'error'
        ? 'border-status-lost/30 bg-status-lost/10 text-status-lost'
        : 'border-gold/30 bg-gold/10 text-gold-deep'
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle
  return (
    <div className={cn('mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm', styles)} role="status">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
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
  const oauth = isOAuthPlatform(channel.platform)
  const label = PLATFORM_LABELS[channel.platform]
  return (
    <li className="rounded-lg border border-shell-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{label}</p>
          {channel.display_name ? <p className="text-sm text-muted-foreground">{channel.display_name}</p> : null}
        </div>
        <StatusBadge status={badge.key} label={badge.label} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <CapabilityChip label="Post" on={caps.canPost} />
        <CapabilityChip label="Engagement" on={caps.canReadEngagement} />
        <CapabilityChip label="Analytics" on={caps.canReadAnalytics} />
      </div>

      {!caps.configured && caps.reason ? <p className="mt-3 text-sm text-muted-foreground">{caps.reason}</p> : null}
      {channel.token_expires_at ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Credential expires {new Date(channel.token_expires_at).toLocaleDateString()}
        </p>
      ) : null}
      {channel.last_verified_at ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Last verified {new Date(channel.last_verified_at).toLocaleString()}
        </p>
      ) : null}
      {channel.last_error ? <p className="mt-2 text-xs text-status-lost">{channel.last_error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {oauth ? <VerifyChannel id={channel.id} platformLabel={label} /> : null}
        {oauth ? <ConnectLink platform={channel.platform as OAuthPlatform} label={label} reconnect /> : null}
        <DisconnectChannel id={channel.id} platformLabel={label} />
      </div>
    </li>
  )
}

function PlatformRosterCard({ platform, oauth }: { platform: SocialPlatform; oauth?: OAuthUi }) {
  const s = platformSupport(platform)
  const label = PLATFORM_LABELS[platform]
  const canConnect = isOAuthPlatform(platform)
  return (
    <li className="rounded-lg border border-shell-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground">{label}</p>
        <StatusBadge status={s.active ? 'active' : 'pending'} label={s.active ? 'Available' : 'Coming soon'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CapabilityChip label="Post" on={s.canPost} />
        <CapabilityChip label="Engagement" on={s.canReadEngagement} />
        <CapabilityChip label="Analytics" on={s.canReadAnalytics} />
      </div>

      {canConnect ? (
        oauth?.configured ? (
          <div className="mt-4">
            <ConnectLink platform={platform as OAuthPlatform} label={label} />
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {oauth?.reason ?? `${label} OAuth is not configured for this environment.`}
          </p>
        )
      ) : !s.active ? (
        <p className="mt-3 text-xs text-muted-foreground">Adapter ready — activates once platform API access is obtained.</p>
      ) : null}
    </li>
  )
}
