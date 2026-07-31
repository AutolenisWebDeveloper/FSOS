'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Menu, X, Sparkles } from 'lucide-react'
import {
  activeWorkspace,
  activeNavHref,
  workspaceSections,
  portalWorkspaces,
  PORTAL_HOME,
  type Workspace,
  type WorkspacePortal,
} from '@/lib/workspaces/registry'
import { resolveIcon } from '@/lib/workspaces/icons'
import { cn } from '@/lib/utils'

// The premium executive navigation — a SINGLE, labeled, contextual sidebar on the
// navy shell (no separate icon rail). It works as a two-level drill-in:
//
//   LEVEL 1 (portal home) — the section DIRECTORY: every workspace the portal can
//     reach, grouped by section, icon + label. This is "home".
//   LEVEL 2 (drilled into a section) — the active workspace's own sub-navigation,
//     with a "← Back to Dashboard" control that returns to Level 1.
//
// The sidebar SWAPS between the two based on the URL — same registry, same routes,
// same labels, same authorization (a pure function of the URL prefix, enforced by
// middleware + layout guards + RLS). Client-driven because App Router layouts
// persist across navigation, so the active level/section must follow usePathname.

// ─── Shared item styles ───────────────────────────────────────────────────────
// Active = a solid brand-blue (#2C4C9C) pill with white text/icon (matches the
// mockup). Inactive = muted shell ink that lifts on hover.

function navItemClass(active: boolean) {
  return cn(
    'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    active
      ? 'bg-nav-active font-medium text-nav-foreground shadow-elev-xs'
      : 'text-shell-muted hover:bg-nav-hover hover:text-nav-foreground',
  )
}

function NavRow({
  href,
  label,
  icon,
  active,
  ai,
}: {
  href: string
  label: string
  icon: string
  active: boolean
  ai?: boolean
}) {
  const Icon = resolveIcon(icon)
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={navItemClass(active)}>
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-colors',
          active ? 'text-nav-foreground' : 'text-shell-muted group-hover:text-nav-foreground',
        )}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="truncate">{label}</span>
      {ai ? (
        <Sparkles
          className={cn('ml-auto h-3.5 w-3.5 shrink-0', active ? 'text-nav-foreground' : 'text-ai')}
          strokeWidth={2}
          aria-hidden
        />
      ) : null}
    </Link>
  )
}

// ─── Level 1: the section directory ───────────────────────────────────────────
// The active (home) section stays EXPANDED inline: its sub-pages render nested
// beneath its directory row, so they're always one click from home. Every other
// section is a single row that drills in to Level 2.

function Directory({
  portal,
  current,
  pathname,
  hidden,
}: {
  portal: WorkspacePortal
  current: Workspace | undefined
  pathname: string
  hidden: Set<string>
}) {
  const sections = workspaceSections(portal)
  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <div key={s.section} className="space-y-1">
          <span className="mono-label px-2.5 text-nav-section">{s.section}</span>
          <div className="space-y-0.5">
            {s.items.map((w) => {
              const active = current?.id === w.id
              const expanded = active && w.nav.length > 1
              return (
                <React.Fragment key={w.id}>
                  <NavRow href={w.home} label={w.label} icon={w.icon} active={active} ai={w.ai} />
                  {expanded ? (
                    <ul className="ml-[26px] space-y-0.5 border-l border-shell-border/70 pl-2.5 pt-0.5">
                      {w.nav
                        .filter((item) => !hidden.has(item.href))
                        .map((item) => {
                          const subActive = item.href === activeNavHref(w, pathname)
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                aria-current={subActive ? 'page' : undefined}
                                className={cn(
                                  'flex items-center rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                  subActive
                                    ? 'font-medium text-nav-foreground'
                                    : 'text-shell-muted hover:text-nav-foreground',
                                )}
                              >
                                <span className="truncate">{item.label}</span>
                              </Link>
                            </li>
                          )
                        })}
                    </ul>
                  ) : null}
                </React.Fragment>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Level 2: a section's own sub-navigation ──────────────────────────────────

function SectionHeader({ ws }: { ws: Workspace }) {
  const Icon = resolveIcon(ws.icon)
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          ws.ai ? 'ai-shell text-ai-foreground' : 'brand-fill text-primary-foreground',
        )}
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-shell-foreground">{ws.label}</h2>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-shell-muted">{ws.description}</p>
      </div>
    </div>
  )
}

function SectionNav({ ws, pathname, hidden }: { ws: Workspace; pathname: string; hidden: Set<string> }) {
  const activeHref = activeNavHref(ws, pathname)
  return (
    <div className="space-y-0.5">
      {ws.nav
        .filter((item) => !hidden.has(item.href))
        .map((item) => (
          <NavRow key={item.href} href={item.href} label={item.label} icon={item.icon} active={item.href === activeHref} />
        ))}
    </div>
  )
}

function BackToDashboard({ portal }: { portal: WorkspacePortal }) {
  return (
    <Link
      href={PORTAL_HOME[portal]}
      className="group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-shell-muted transition-colors duration-fast hover:bg-nav-hover hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-fast group-hover:-translate-x-0.5" strokeWidth={2} aria-hidden />
      Back to Dashboard
    </Link>
  )
}

// ─── Desktop nav (single contextual sidebar) ──────────────────────────────────

export function WorkspaceNav({
  portal,
  panels,
  hiddenHrefs,
}: {
  portal: WorkspacePortal
  /** Server-rendered character panels slotted into the sidebar footer. */
  panels?: React.ReactNode
  /** Sub-nav hrefs to hide (server-gated items, e.g. partner comp disclosure). */
  hiddenHrefs?: string[]
}) {
  const pathname = usePathname() ?? PORTAL_HOME[portal]
  const ws = activeWorkspace(portal, pathname)
  const hidden = React.useMemo(() => new Set(hiddenHrefs ?? []), [hiddenHrefs])

  // Directory (Level 1) only when the portal has more than one workspace AND we're
  // at its home route. Single-workspace portals (partner/client) always show their
  // section nav — a one-item directory would be pointless.
  const multi = portalWorkspaces(portal).length > 1
  const isRoot = pathname === PORTAL_HOME[portal]
  const showDirectory = multi && isRoot

  return (
    <aside className="shell-gradient shell-hairline sticky top-14 hidden h-[calc(100vh-3.5rem)] w-sidebar shrink-0 flex-col overflow-y-auto border-r border-shell-border px-3 py-4 md:flex">
      {showDirectory ? (
        <nav aria-label="Dashboard sections" className="flex-1">
          <Directory portal={portal} current={ws} pathname={pathname} hidden={hidden} />
        </nav>
      ) : ws ? (
        <>
          {multi ? (
            <div className="mb-3">
              <BackToDashboard portal={portal} />
            </div>
          ) : null}
          <SectionHeader ws={ws} />
          <div className="my-4 border-t border-shell-border" />
          <nav aria-label={`${ws.label} navigation`} className="flex-1">
            <SectionNav ws={ws} pathname={pathname} hidden={hidden} />
          </nav>
        </>
      ) : (
        <nav aria-label="Dashboard sections" className="flex-1">
          <Directory portal={portal} current={ws} pathname={pathname} hidden={hidden} />
        </nav>
      )}
      {panels ? <div className="mt-6 border-t border-shell-border pt-5">{panels}</div> : null}
    </aside>
  )
}

// ─── Mobile: hamburger trigger + full-height drawer (the section directory) ────

export function WorkspaceMobileNav({ portal, portalLabel }: { portal: WorkspacePortal; portalLabel: string }) {
  const pathname = usePathname() ?? PORTAL_HOME[portal]
  const [open, setOpen] = React.useState(false)
  const ws = activeWorkspace(portal, pathname)
  const sections = workspaceSections(portal)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  // Close on route change.
  React.useEffect(() => setOpen(false), [pathname])

  // Lock scroll + Escape while open; move focus into the drawer on open and
  // return it to the trigger on close (WCAG 2.2 AA — focus follows the overlay).
  React.useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const id = window.setTimeout(() => closeRef.current?.focus(), 20)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKey)
      trigger?.focus()
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-shell-muted transition-colors duration-fast hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={`${portalLabel} navigation`}>
          <button className="scrim absolute inset-0" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="shell-gradient absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col overflow-y-auto border-r border-shell-border px-3 py-4 text-shell-foreground">
            <div className="flex items-center justify-between px-1">
              <span className="mono-label text-shell-muted">{portalLabel}</span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-shell-muted hover:bg-shell-raised hover:text-shell-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
            <div className="mt-4 space-y-5">
              {sections.map((s) => (
                <div key={s.section} className="space-y-1">
                  <span className="mono-label px-2 text-nav-section">{s.section}</span>
                  <div className="space-y-0.5">
                    {s.items.map((w) => (
                      <NavRow key={w.id} href={w.home} label={w.label} icon={w.icon} active={ws?.id === w.id} ai={w.ai} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
