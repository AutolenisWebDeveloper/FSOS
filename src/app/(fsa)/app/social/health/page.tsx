import Link from 'next/link'
import { Activity, KeyRound, AlertTriangle, Clock, ShieldCheck, Gauge, Webhook, CheckCircle2 } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, StatTile, EmptyState, ErrorState } from '@/components/archetypes'
import { getSocialHealth } from '@/lib/social/health'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import { SOCIAL_PLATFORMS, platformSupport, type SocialPlatform } from '@/lib/social/adapters'
import type { OverallHealth, PlatformHealth } from '@/lib/social/health-agg'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TONE_TEXT: Record<PlatformHealth['tone'], string> = {
  success: 'text-status-won',
  warning: 'text-gold-deep',
  error: 'text-status-lost',
  neutral: 'text-muted-foreground',
}

const OVERALL: Record<OverallHealth, { label: string; tone: PlatformHealth['tone']; desc: string }> = {
  healthy: { label: 'All systems healthy', tone: 'success', desc: 'Connected accounts are healthy and publishing is unobstructed.' },
  degraded: { label: 'Degraded', tone: 'warning', desc: 'Something needs attention before it interrupts publishing — see below.' },
  down: { label: 'Action required', tone: 'error', desc: 'A connection is broken and will block publishing until reconnected.' },
  idle: { label: 'No connected accounts', tone: 'neutral', desc: 'Connect a platform to begin publishing and monitoring health.' },
}

function platformLabel(p: string): string {
  return p in PLATFORM_LABELS ? PLATFORM_LABELS[p as SocialPlatform] : p
}

export default async function SocialHealthPage() {
  await requireRole('fsa', '/app/social/health')
  const res = await getSocialHealth()
  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Health' },
  ]

  if (!res.ok) {
    return (
      <ListShell title="Platform health" description="Operational status of your social connections." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <EmptyState icon={Activity} title="Database not configured" description="Set the Supabase environment variables to load platform health." />
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  const h = res.data
  const overall = OVERALL[h.overall]
  const inactive = SOCIAL_PLATFORMS.filter((p) => !platformSupport(p).active)

  return (
    <ListShell
      title="Platform health"
      description="Operational status of your social connections — token expiry surfaced before it can break the publish queue, plus recent publish failures and queue depth."
      breadcrumb={breadcrumb}
    >
      <div className={'mb-6 flex items-start gap-2 rounded-lg border p-3 ' + (h.overall === 'down' ? 'border-status-lost/30 bg-status-lost/5' : h.overall === 'degraded' ? 'border-gold/30 bg-gold/10' : h.overall === 'healthy' ? 'border-status-won/30 bg-status-won/5' : 'border-shell-border bg-muted/20')}>
        {h.overall === 'healthy' ? <CheckCircle2 className={'mt-0.5 h-5 w-5 ' + TONE_TEXT[overall.tone]} aria-hidden /> : <AlertTriangle className={'mt-0.5 h-5 w-5 ' + TONE_TEXT[overall.tone]} aria-hidden />}
        <div>
          <p className={'text-sm font-semibold ' + TONE_TEXT[overall.tone]}>{overall.label}</p>
          <p className="text-xs text-muted-foreground">{overall.desc}</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Tokens expiring" value={h.tokensExpiringSoon} icon={Clock} tone={h.tokensExpiringSoon > 0 ? 'attention' : 'neutral'} hint="within 7 days" />
        <StatTile label="Tokens expired" value={h.tokensExpired} icon={KeyRound} tone={h.tokensExpired > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Recent failures" value={h.totalRecentFailures} icon={AlertTriangle} tone={h.totalRecentFailures > 0 ? 'attention' : 'neutral'} />
        <StatTile label="Queue pending" value={h.queue.pending} icon={Clock} href="/app/social/queue" />
        <StatTile label="Queue failed" value={h.queue.failed} icon={AlertTriangle} href="/app/social/queue" tone={h.queue.failed > 0 ? 'attention' : 'neutral'} />
      </div>

      <Section title="Connected platforms" description="Live status of each connected account, with proactive token-expiry warnings.">
        {h.platforms.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No connected accounts"
            description="Connect a platform to monitor its health."
            action={<Link href="/app/social/accounts" className="text-sm font-medium text-primary hover:underline">Go to accounts</Link>}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {h.platforms.map((p) => (
              <li key={p.platform} className="rounded-lg border border-shell-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">{platformLabel(p.platform)}</p>
                  <span className={'text-xs font-medium ' + TONE_TEXT[p.tone]}>{p.state.replace('_', ' ')}</span>
                </div>
                <p className={'mt-1 text-sm ' + TONE_TEXT[p.tone]}>{p.summary}</p>

                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {p.tokenExpiresAt ? (
                    <p className={p.expired ? 'text-status-lost' : p.expiringSoon ? 'text-gold-deep' : ''}>
                      <KeyRound className="mr-1 inline h-3 w-3" aria-hidden />
                      {p.expired
                        ? 'Token expired — reconnect to resume publishing.'
                        : p.expiresInDays != null
                          ? `Token valid ~${p.expiresInDays} more day${p.expiresInDays === 1 ? '' : 's'}.`
                          : 'Token active.'}
                    </p>
                  ) : (
                    <p>
                      <KeyRound className="mr-1 inline h-3 w-3" aria-hidden />
                      Long-lived token (no fixed expiry).
                    </p>
                  )}
                  {p.lastVerifiedAt ? (
                    <p>
                      <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden />
                      Last verified {new Date(p.lastVerifiedAt).toLocaleString()}
                    </p>
                  ) : null}
                  {p.recentFailures > 0 ? (
                    <p className="text-status-lost">
                      <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                      {p.recentFailures} recent publish failure{p.recentFailures === 1 ? '' : 's'}
                      {p.rateLimited ? ' · rate-limited' : ''}
                      {p.lastFailure?.reason ? ` — ${p.lastFailure.reason}` : ''}
                    </p>
                  ) : null}
                </div>

                {p.tone !== 'success' ? (
                  <div className="mt-3">
                    <Link href="/app/social/accounts" className="text-xs font-medium text-primary hover:underline">
                      Manage in accounts →
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {h.recentFailures.length > 0 ? (
        <Section title="Recent publish failures" description="The most recent publish attempts that failed, with the platform's reason." className="mt-6">
          <ul className="divide-y divide-shell-border rounded-lg border border-shell-border bg-card">
            {h.recentFailures.slice(0, 15).map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {platformLabel(f.platform)}
                    {f.code ? <span className="text-muted-foreground"> · {f.code}</span> : ''}
                  </p>
                  {f.reason ? <p className="truncate text-xs text-muted-foreground">{f.reason}</p> : null}
                </div>
                <span className="numeric shrink-0 text-xs text-muted-foreground">
                  attempt {f.attempt} · {new Date(f.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Signals not yet tracked" description="Surfaced honestly so gaps aren't mistaken for green." className="mt-6">
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="rounded-lg border border-dashed border-shell-border bg-muted/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Gauge className="h-4 w-4" aria-hidden /> Rate-limit headroom
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Inferred from recent rate-limited publish attempts, not from live API quota headers. A dedicated headroom meter needs
              platform quota reporting, which isn&apos;t captured yet.
            </p>
          </li>
          <li className="rounded-lg border border-dashed border-shell-border bg-muted/10 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Webhook className="h-4 w-4" aria-hidden /> Webhook delivery
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Inbound platform webhooks aren&apos;t configured for social; engagement is ingested manually. Delivery status will appear
              here once a platform webhook is connected.
            </p>
          </li>
        </ul>
        {inactive.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Adapters not yet activated (no API access obtained): {inactive.map((p) => platformLabel(p)).join(', ')}.
          </p>
        ) : null}
      </Section>
    </ListShell>
  )
}
