import Link from 'next/link'
import { Bell, LayoutGrid, LifeBuoy, ShieldCheck, ChevronRight } from 'lucide-react'
import { SettingsShell, SettingsSection, MonoLabel } from '@/components/archetypes'
import { Badge } from '@/components/ui/badge'
import { AccountActions } from '@/components/app/AccountActions'
import { getServerSession, getCurrentUserEmail } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QUICK_LINKS = [
  { href: '/app/notifications', label: 'Notifications', description: 'Alerts, escalations, and reminders.', icon: Bell },
  { href: '/app', label: 'Dashboard layout', description: 'Arrange the widgets on your command center.', icon: LayoutGrid },
  { href: '/app/compliance', label: 'Compliance center', description: 'Consent, DNC, licenses, and the firewall.', icon: ShieldCheck },
  { href: '/app/help', label: 'Help & support', description: 'Guides and how to reach a person.', icon: LifeBuoy },
]

// A10 Settings — the FSA account page. Identity + security live here; the sign-out
// and password-reset actions run through the existing Supabase auth client
// (no new backend surface). Interactive account controls are the one client island.
export default async function SettingsPage() {
  const [session, email] = await Promise.all([getServerSession(), getCurrentUserEmail()])
  const primaryRole = session?.roles?.[0]?.replace(/_/g, ' ') ?? null

  return (
    <SettingsShell title="Settings" description="Manage your account, security, and workspace preferences.">
      {/* Profile */}
      <SettingsSection title="Profile" description="How you're identified across FSOS.">
        <dl className="divide-y divide-border rounded-lg border">
          <Row label="Email">
            <span className="text-sm">{email ?? '—'}</span>
          </Row>
          <Row label="Role">
            {primaryRole ? (
              <span className="text-sm capitalize">{primaryRole}</span>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="User ID">
            <span className="numeric text-xs text-muted-foreground">{session?.userId ?? '—'}</span>
          </Row>
        </dl>
      </SettingsSection>

      {/* Security */}
      <SettingsSection title="Security" description="Multi-factor authentication and password.">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Two-factor authentication</p>
            <p className="text-xs text-muted-foreground">Required for the gated portals.</p>
          </div>
          {session?.mfaSatisfied ? (
            <Badge variant="won">Active</Badge>
          ) : (
            <Badge variant="pending">Not verified</Badge>
          )}
        </div>
        <div className="space-y-2">
          <MonoLabel>Account actions</MonoLabel>
          <AccountActions email={email} />
          <p className="text-xs text-muted-foreground">
            The reset link is emailed to your address on file. Signing out ends this session on this device.
          </p>
        </div>
      </SettingsSection>

      {/* Workspace */}
      <SettingsSection title="Workspace" description="Jump to the areas you configure most.">
        <div className="grid gap-2 sm:grid-cols-2">
          {QUICK_LINKS.map((l) => {
            const Icon = l.icon
            return (
              <Link
                key={l.href}
                href={l.href}
                className="group flex items-center gap-3 rounded-lg border p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{l.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{l.description}</span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                  aria-hidden
                />
              </Link>
            )
          })}
        </div>
      </SettingsSection>
    </SettingsShell>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <MonoLabel>{label}</MonoLabel>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  )
}
