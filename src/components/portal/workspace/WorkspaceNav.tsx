'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, Menu, X, Sparkles } from 'lucide-react'
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

// The premium executive navigation: a 64px icon RAIL (the workspace switcher) +
// a 260px contextual SIDEBAR (the active workspace's sub-nav) + a portal-scoped
// back control. Client-driven because App Router layouts persist across
// navigation — the active workspace/sub-nav must follow usePathname, not a
// server render that would go stale. Authorization is unaffected: every link
// here is a route the current portal already gates to (registry invariants).

// ─── Rail: the workspace switcher ─────────────────────────────────────────────

function RailItem({ w, active }: { w: Workspace; active: boolean }) {
  const Icon = resolveIcon(w.icon)
  return (
    <Link
      href={w.home}
      aria-label={w.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active ? 'bg-nav-active text-nav-foreground' : 'text-nav-muted hover:bg-nav-hover hover:text-nav-foreground',
        w.ai && active && 'ring-1 ring-inset ring-ai/60',
      )}
    >
      {/* Active accent bar. */}
      <span
        className={cn(
          'absolute left-[-10px] h-6 w-1 rounded-full transition-all duration-fast',
          active ? (w.ai ? 'bg-ai' : 'bg-nav-active-bar') : 'bg-transparent',
        )}
        aria-hidden
      />
      <Icon className="h-[19px] w-[19px]" strokeWidth={1.75} aria-hidden />
      {/* Hover tooltip (premium, dependency-free). */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full z-50 ml-3 hidden -translate-x-1 whitespace-nowrap rounded-md border border-shell-border bg-palette px-2.5 py-1.5 text-xs font-medium text-palette-foreground opacity-0 shadow-elev-lg transition-all duration-fast group-hover:block group-hover:translate-x-0 group-hover:opacity-100"
      >
        {w.label}
        {w.ai ? <Sparkles className="ml-1 inline h-3 w-3 text-ai" strokeWidth={2} aria-hidden /> : null}
      </span>
    </Link>
  )
}

function Rail({ portal, pathname }: { portal: WorkspacePortal; pathname: string }) {
  const sections = workspaceSections(portal)
  const current = activeWorkspace(portal, pathname)
  return (
    <nav
      aria-label="Workspaces"
      className="shell-gradient sticky top-14 hidden h-[calc(100vh-3.5rem)] w-rail shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-shell-border py-3 md:flex"
    >
      {sections.map((s, i) => (
        <React.Fragment key={s.section}>
          {i > 0 ? <span className="my-1 h-px w-6 bg-shell-border" aria-hidden /> : null}
          {s.items.map((w) => (
            <RailItem key={w.id} w={w} active={current?.id === w.id} />
          ))}
        </React.Fragment>
      ))}
    </nav>
  )
}

// ─── Contextual sidebar: the active workspace's sub-nav ───────────────────────

function SubNav({ ws, pathname, hidden }: { ws: Workspace; pathname: string; hidden: Set<string> }) {
  const activeHref = activeNavHref(ws, pathname)
  return (
    <div className="space-y-0.5">
      {ws.nav.filter((item) => !hidden.has(item.href)).map((item) => {
        const Icon = resolveIcon(item.icon)
        const active = item.href === activeHref
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active
                ? 'bg-nav-active font-medium text-nav-foreground'
                : 'text-shell-muted hover:bg-nav-hover hover:text-nav-foreground',
            )}
          >
            <Icon
              className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-accent' : 'text-shell-muted group-hover:text-nav-foreground')}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="truncate">{item.label}</span>
          </Link>
        )
      })}
    </div>
  )
}

function WorkspaceHeader({ ws, portal }: { ws: Workspace; portal: WorkspacePortal }) {
  const Icon = resolveIcon(ws.icon)
  const home = portalWorkspaces(portal)[0]
  const atHome = ws.id === home?.id
  return (
    <div className="space-y-3">
      {/* Portal-scoped back control — targets THIS portal's home workspace, never
          a cross-portal '/app' (security-audit-slice1 §7). Hidden when already home. */}
      {!atHome && home ? (
        <Link
          href={PORTAL_HOME[portal]}
          className="inline-flex items-center gap-1 rounded-md text-xs font-medium text-shell-muted transition-colors duration-fast hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {home.label}
        </Link>
      ) : null}
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            ws.ai ? 'ai-shell text-ai-foreground' : 'bg-shell-raised text-accent',
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
    </div>
  )
}

// ─── Desktop nav (rail + sidebar) ─────────────────────────────────────────────

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
  return (
    <>
      <Rail portal={portal} pathname={pathname} />
      {ws ? (
        <aside className="shell-gradient shell-hairline sticky top-14 hidden h-[calc(100vh-3.5rem)] w-sidebar shrink-0 flex-col overflow-y-auto border-r border-shell-border px-3 py-4 md:flex">
          <WorkspaceHeader ws={ws} portal={portal} />
          <div className="my-4 border-t border-shell-border" />
          <nav aria-label={`${ws.label} navigation`} className="flex-1">
            <SubNav ws={ws} pathname={pathname} hidden={hidden} />
          </nav>
          {panels ? <div className="mt-6 border-t border-shell-border pt-5">{panels}</div> : null}
        </aside>
      ) : null}
    </>
  )
}

// ─── Mobile: hamburger trigger + full-height drawer ───────────────────────────

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
    // Capture the trigger node now so focus returns to it on close (it is always
    // mounted, so this is stable across the effect's lifetime).
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
                    {s.items.map((w) => {
                      const Icon = resolveIcon(w.icon)
                      const active = ws?.id === w.id
                      return (
                        <Link
                          key={w.id}
                          href={w.home}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors duration-fast',
                            active ? 'bg-nav-active font-medium text-nav-foreground' : 'text-shell-muted hover:bg-nav-hover hover:text-nav-foreground',
                          )}
                        >
                          <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-accent' : '')} strokeWidth={1.75} aria-hidden />
                          <span className="truncate">{w.label}</span>
                          {w.ai ? <Sparkles className="ml-auto h-3.5 w-3.5 text-ai" strokeWidth={2} aria-hidden /> : null}
                        </Link>
                      )
                    })}
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
