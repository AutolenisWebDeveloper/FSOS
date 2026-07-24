import Link from 'next/link'
import { ShieldCheck, Link2, CheckCircle2, Lock, ArrowLeft, PlugZap } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { ListShell, Section, EmptyState } from '@/components/archetypes'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import { isOAuthPlatform, providerConfig, type OAuthPlatform } from '@/lib/social/oauth'
import { explainScopes, grantedCapabilities, type SocialCapability } from '@/lib/social/onboarding'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CAPABILITY_LABELS: Record<SocialCapability, string> = {
  publish: 'Publish approved posts',
  read_engagement: 'Read comments & reactions',
  read_analytics: 'Read post analytics',
}

// Guided connection step (operational depth item 1): explain WHICH permissions are
// requested and WHY, and what FSOS will be able to do, BEFORE the user leaves for the
// provider's OAuth screen. Every off-ramp is an honest state with a next action.
export default async function ConnectPlatformPage(props: { params: Promise<{ platform: string }> }) {
  await requireRole('fsa', '/app/social/accounts')
  const { platform } = await props.params

  const breadcrumb = [
    { label: 'FSA', href: '/app' },
    { label: 'Social', href: '/app/social' },
    { label: 'Accounts', href: '/app/social/accounts' },
    { label: 'Connect' },
  ]

  const backToAccounts = (
    <Link href="/app/social/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to accounts
    </Link>
  )

  // Platform without an activated OAuth path → honest "not available yet" state.
  if (!isOAuthPlatform(platform)) {
    const label = platform in PLATFORM_LABELS ? PLATFORM_LABELS[platform as keyof typeof PLATFORM_LABELS] : platform
    return (
      <ListShell title="Connect an account" description="Guided account connection." breadcrumb={breadcrumb}>
        <EmptyState
          icon={PlugZap}
          title={`${label} can't be connected yet`}
          description="This platform's publishing API isn't activated in FSOS. It will appear here once API access is obtained."
          action={backToAccounts}
        />
      </ListShell>
    )
  }

  const p = platform as OAuthPlatform
  const label = PLATFORM_LABELS[p]
  const cfg = providerConfig(p)

  // OAuth not configured for this environment → honest, labeled state (no crash, §4.3).
  if (!cfg.configured) {
    return (
      <ListShell title={`Connect ${label}`} description="Guided account connection." breadcrumb={breadcrumb}>
        <EmptyState
          icon={Lock}
          title={`${label} connection isn't configured yet`}
          description={cfg.reason ?? `${label} OAuth credentials are not set for this environment.`}
          action={backToAccounts}
        />
      </ListShell>
    )
  }

  const scopes = explainScopes(p)
  const capabilities = grantedCapabilities(p)

  return (
    <ListShell
      title={`Connect ${label}`}
      description={`You're about to connect a ${label} account so FSOS can publish approved content and read its performance.`}
      breadcrumb={breadcrumb}
      actions={backToAccounts}
    >
      <Section title="What FSOS will be able to do" description="Only after you approve each post — FSOS never publishes on its own.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {capabilities.map((c) => (
            <li key={c} className="flex items-center gap-2 rounded-lg border border-shell-border bg-card p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-status-won" aria-hidden />
              {CAPABILITY_LABELS[c]}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Permissions you'll be asked to grant" description="Grant all of them so publishing and analytics work — a partial grant leaves the connection incomplete." className="mt-6">
        <ul className="space-y-2">
          {scopes.map((s) => (
            <li key={s.scope} className="rounded-lg border border-shell-border bg-card p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                {s.label}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{s.why}</p>
            </li>
          ))}
        </ul>
      </Section>

      <div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-shell-border bg-muted/20 p-4">
        <p className="text-xs text-muted-foreground">
          FSOS stores your access token encrypted and never exposes it to the browser. It publishes only content you've approved,
          and only to the {p === 'facebook_page' ? 'Page' : 'channel'} you connect — never a personal profile. You can disconnect anytime.
        </p>
        <a
          href={`/api/social/oauth/${p}/start`}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Continue to {label}
        </a>
      </div>
    </ListShell>
  )
}
