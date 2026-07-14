import * as React from 'react'
import { NavLink } from './NavLink'

export interface NavItem {
  href: string
  label: string
}

/**
 * Shared portal chrome (middleware-auth.md §6.4): top bar + left nav + content.
 * The nav passed in is already permission-filtered by the portal layout. A
 * standing banner slot carries the compliance-portal supervisory disclaimer.
 */
export function PortalShell({
  portalLabel,
  nav,
  banner,
  children,
}: {
  portalLabel: string
  nav: NavItem[]
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">FSOS</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{portalLabel}</span>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {/* Global search, notifications, AI-priorities bell, profile, portal
              switcher are wired in P0/P1; the shell reserves their slot here. */}
          <span aria-hidden>⌘K</span>
        </div>
      </header>
      {banner}
      <div className="mx-auto flex w-full max-w-screen-2xl gap-6 px-4 py-6">
        <nav aria-label={`${portalLabel} navigation`} className="hidden w-52 shrink-0 space-y-0.5 md:block">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
