import * as React from 'react'
import Link from 'next/link'
import { Bell, Sparkles } from 'lucide-react'
import { ProfileMenu } from '../ProfileMenu'
import { BrandMark } from '../BrandMark'
import { MonoLabel } from '@/components/ui/typography'
import { PORTAL_HOME, type WorkspacePortal } from '@/lib/workspaces/registry'
import { CommandPalette } from './CommandPalette'
import { WorkspaceNav, WorkspaceMobileNav } from './WorkspaceNav'

/**
 * Advisor OS shell (redesign) — the workspace-aware replacement for PortalShell.
 * A dark Farmers-navy shell (topbar + icon rail + contextual sidebar) wraps the
 * light content canvas. It is a NAVIGATION + LAYOUT layer only: authorization is
 * unchanged (portal gate + layout guard + RLS). The nav is generated from the
 * static Workspace Registry, filtered to `portal`.
 *
 * Server component: the shell chrome renders on the server; the interactive
 * pieces (rail/sidebar active state, palette, mobile drawer) are the client
 * islands WorkspaceNav / CommandPalette / WorkspaceMobileNav. Page content
 * (children) stays server-rendered.
 */
export function WorkspaceShell({
  portal,
  portalLabel,
  panels,
  banner,
  assistantHref,
  notificationsHref,
  settingsHref,
  hiddenHrefs,
  children,
}: {
  portal: WorkspacePortal
  portalLabel: string
  /** Server-rendered character panels for the sidebar footer (FSA). */
  panels?: React.ReactNode
  /** Compliance supervisory banner, etc. */
  banner?: React.ReactNode
  assistantHref?: string
  notificationsHref?: string
  settingsHref?: string
  /** Sub-nav hrefs to hide, for server-gated items (e.g. partner comp disclosure).
   *  Hiding is presentation only — the route still enforces its own guard. */
  hiddenHrefs?: string[]
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-elev-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>

      {/* ── Topbar (56px) ─────────────────────────────────────────────────── */}
      <header className="shell-gradient shell-hairline sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-shell-border px-3 text-shell-foreground shadow-elev-md backdrop-blur-md supports-[backdrop-filter]:bg-shell/85 md:px-4">
        <WorkspaceMobileNav portal={portal} portalLabel={portalLabel} />
        <Link
          href={PORTAL_HOME[portal]}
          className="flex items-center gap-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={`${portalLabel} home`}
        >
          <BrandMark size="sm" />
          <MonoLabel muted={false} className="hidden text-shell-muted sm:block">
            {portalLabel}
          </MonoLabel>
        </Link>

        <div className="mx-1 hidden h-6 w-px bg-shell-border md:block" aria-hidden />

        {/* ⌘K palette trigger (reads as global search). */}
        <CommandPalette portal={portal} hiddenHrefs={hiddenHrefs} />

        <div className="ml-auto flex items-center gap-1">
          {assistantHref ? (
            <Link
              href={assistantHref}
              aria-label="AI assistant"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-shell-muted transition-colors duration-fast hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          {notificationsHref ? (
            <Link
              href={notificationsHref}
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-shell-muted transition-colors duration-fast hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          <ProfileMenu settingsHref={settingsHref} />
        </div>
      </header>

      {/* ── Rail + contextual sidebar + content ───────────────────────────── */}
      <div className="flex">
        <WorkspaceNav portal={portal} panels={panels} hiddenHrefs={hiddenHrefs} />
        <div className="min-w-0 flex-1">
          {banner}
          <main id="content" tabIndex={-1} className="mx-auto w-full max-w-[1400px] px-4 pb-16 pt-5 focus:outline-none md:px-6 md:pb-10 md:pt-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
