import * as React from 'react'
import Link from 'next/link'
import { Bell, Search, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { NavLink } from './NavLink'
import { MobileTabBar } from './MobileTabBar'
import { ProfileMenu } from './ProfileMenu'
import { IdentityLockup } from './CharacterPanels'
import { MonoLabel } from '@/components/ui/typography'

export interface NavItem {
  href: string
  label: string
  /** lucide-react icon (18px, stroke 1.75). */
  icon?: LucideIcon
  /** OS cluster the item groups under (rendered as a mono label). */
  group?: string
  /** Right-aligned count pill (e.g. referrals awaiting action). */
  count?: number
}

interface NavGroup {
  label: string
  items: NavItem[]
}

// Group nav items by their `group` (design-system.md §5.2) preserving first-seen
// order; ungrouped items fall under a single "NAVIGATION" cluster.
function groupNav(nav: NavItem[]): NavGroup[] {
  const order: string[] = []
  const map = new Map<string, NavItem[]>()
  for (const item of nav) {
    const key = item.group ?? 'Navigation'
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(item)
  }
  return order.map((label) => ({ label, items: map.get(label)! }))
}

/**
 * Shared branded shell (docs/design-system.md §4–5): dark navy sidebar + topbar
 * wrapping a light content canvas. The nav passed in is already permission-filtered
 * by the portal layout. `panels` renders the character panels (FSA sidebar); a
 * `banner` slot carries the compliance supervisory disclaimer.
 */
export function PortalShell({
  portalLabel,
  nav,
  banner,
  panels,
  searchHref,
  assistantHref,
  notificationsHref,
  settingsHref,
  children,
}: {
  portalLabel: string
  nav: NavItem[]
  banner?: React.ReactNode
  panels?: React.ReactNode
  /** Topbar wiring. When a portal provides these, the search box / AI / bell
   * become live; portals that omit them keep the inert placeholders (no change). */
  searchHref?: string
  assistantHref?: string
  notificationsHref?: string
  /** Account-menu target for this portal's settings/preferences page. */
  settingsHref?: string
  children: React.ReactNode
}) {
  const groups = groupNav(nav)
  const homeHref = nav[0]?.href ?? '/'
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Topbar (56px, dark shell) ────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-shell-border bg-shell/95 px-4 text-shell-foreground shadow-elev-sm backdrop-blur-md supports-[backdrop-filter]:bg-shell/80">
        <div className="flex items-center gap-2 md:hidden">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-primary text-sm font-semibold text-primary-foreground ring-1 ring-white/10">
            M
          </div>
          <MonoLabel muted={false} className="text-shell-muted">
            {portalLabel}
          </MonoLabel>
        </div>
        {/* Global search — rendered only where the portal wires a target, so no
            portal ever shows a dead search field. Otherwise a spacer keeps the
            account actions right-aligned. */}
        {searchHref ? (
          <form action={searchHref} role="search" className="relative hidden max-w-md flex-1 items-center md:flex">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-shell-muted" strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              name="q"
              placeholder="Search…"
              aria-label="Global search"
              className="h-9 w-full rounded-lg border border-shell-border bg-shell-raised pl-9 pr-3 text-sm text-shell-foreground placeholder:text-shell-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </form>
        ) : (
          <div className="hidden flex-1 md:block" aria-hidden />
        )}
        <div className="ml-auto flex items-center gap-1">
          {assistantHref ? (
            <Link
              href={assistantHref}
              aria-label="AI assistant"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          {notificationsHref ? (
            <Link
              href={notificationsHref}
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          <ProfileMenu settingsHref={settingsHref} />
        </div>
      </header>

      <div className="flex">
        {/* ── Sidebar (260px, dark shell) ────────────────────────────────── */}
        <aside className="shell-gradient sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col overflow-y-auto border-r border-shell-border px-3 py-4 md:flex">
          <Link href={homeHref} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <IdentityLockup portalLabel={`${portalLabel} Command Center`} />
          </Link>
          <div className="my-4 border-t border-shell-border" />
          <nav aria-label={`${portalLabel} navigation`} className="flex-1 space-y-5">
            {groups.map((g) => (
              <div key={g.label} className="space-y-1">
                <MonoLabel muted={false} className="px-2 text-shell-muted">
                  {g.label}
                </MonoLabel>
                <div className="space-y-0.5">
                  {g.items.map((item) => {
                    // Render the lucide icon here (server) so no component function
                    // crosses into the client NavLink.
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={Icon ? <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden /> : undefined}
                        count={item.count}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
          {panels ? <div className="mt-6 border-t border-shell-border pt-5">{panels}</div> : null}
        </aside>

        {/* ── Content canvas (light) ─────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {banner}
          <main className="mx-auto w-full max-w-[1400px] px-4 pb-20 pt-6 md:px-6 md:pb-8">{children}</main>
        </div>
      </div>

      <MobileTabBar
        items={nav.map((item) => {
          const Icon = item.icon
          return {
            href: item.href,
            label: item.label,
            icon: Icon ? <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden /> : undefined,
          }
        })}
        overflowHref={homeHref}
      />
    </div>
  )
}
