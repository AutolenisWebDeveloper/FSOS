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
  panels,
  children,
}: {
  portalLabel: string
  nav: NavItem[]
  banner?: React.ReactNode
  /** Sidebar character panels (design-system.md §5.3) rendered below the nav. */
  panels?: React.ReactNode
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
        <div className="hidden w-52 shrink-0 md:block">
          <nav aria-label={`${portalLabel} navigation`} className="space-y-0.5">
            {nav.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} />
            ))}
          </nav>
          {panels ? <div className="mt-6 space-y-4">{panels}</div> : null}
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
