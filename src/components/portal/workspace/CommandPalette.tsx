'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { portalWorkspaces, type WorkspacePortal } from '@/lib/workspaces/registry'
import { resolveIcon } from '@/lib/workspaces/icons'
import { cn } from '@/lib/utils'

// ⌘K navigation palette — jump to any workspace or page the current session can
// reach. Scoped to the active portal, sourced from the static Workspace Registry,
// so it exposes NO route outside the portal gate (adds no API, no new authority).
// Entity search stays in the portal's dedicated search page.

interface Cmd {
  id: string
  label: string
  hint: string
  href: string
  icon: string
  keywords: string
}

function buildCommands(portal: WorkspacePortal): Cmd[] {
  const cmds: Cmd[] = []
  for (const w of portalWorkspaces(portal)) {
    cmds.push({
      id: `ws:${w.id}`,
      label: w.label,
      hint: 'Workspace',
      href: w.home,
      icon: w.icon,
      keywords: `${w.label} ${w.description}`.toLowerCase(),
    })
    for (const item of w.nav) {
      cmds.push({
        id: `nav:${item.href}`,
        label: item.label,
        hint: w.label,
        href: item.href,
        icon: item.icon,
        keywords: `${item.label} ${w.label}`.toLowerCase(),
      })
    }
  }
  // De-dupe by href (a workspace home may equal its first nav item).
  const seen = new Set<string>()
  return cmds.filter((c) => (seen.has(c.href) ? false : (seen.add(c.href), true)))
}

export function CommandPalette({ portal, hiddenHrefs }: { portal: WorkspacePortal; hiddenHrefs?: string[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const commands = React.useMemo(() => {
    const hidden = new Set(hiddenHrefs ?? [])
    return buildCommands(portal).filter((c) => !hidden.has(c.href))
  }, [portal, hiddenHrefs])
  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice(0, 8)
    return commands.filter((c) => c.keywords.includes(q)).slice(0, 12)
  }, [commands, query])

  // Global ⌘K / Ctrl+K toggle.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reset + focus on open.
  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      const id = window.setTimeout(() => inputRef.current?.focus(), 20)
      return () => window.clearTimeout(id)
    }
  }, [open])

  React.useEffect(() => setActive(0), [query])

  function choose(href: string) {
    setOpen(false)
    router.push(href)
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[active]
      if (hit) choose(hit.href)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  // Keep the active row scrolled into view.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <>
      {/* Topbar trigger — reads as the global search field but opens the palette. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        aria-keyshortcuts="Meta+K Control+K"
        className="group hidden h-9 max-w-md flex-1 items-center gap-2 rounded-lg border border-shell-border bg-shell-raised/70 pl-3 pr-2 text-left text-sm text-shell-muted transition-colors duration-fast hover:border-shell-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:flex"
      >
        <Search className="h-4 w-4 shrink-0 transition-colors group-hover:text-accent" strokeWidth={1.75} aria-hidden />
        <span className="flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-shell-border bg-palette-kbd px-1.5 py-0.5 font-mono text-[10px] font-medium text-shell-muted sm:flex">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <button className="scrim absolute inset-0 cursor-default" aria-label="Close" tabIndex={-1} onClick={() => setOpen(false)} />
          <div className="animate-scale-in relative w-full max-w-xl overflow-hidden rounded-xl border border-palette-border bg-palette text-palette-foreground shadow-elev-2xl">
            <div className="flex items-center gap-2 border-b border-palette-border px-4">
              <Search className="h-4 w-4 shrink-0 text-palette-muted" strokeWidth={1.75} aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search workspaces and pages…"
                aria-label="Search workspaces and pages"
                className="h-12 w-full bg-transparent text-sm text-palette-foreground placeholder:text-palette-muted focus:outline-none"
              />
              <kbd className="rounded border border-palette-border bg-palette-kbd px-1.5 py-0.5 font-mono text-[10px] text-palette-muted">esc</kbd>
            </div>
            {results.length ? (
              <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
                {results.map((c, i) => {
                  const Icon = resolveIcon(c.icon)
                  const isActive = i === active
                  return (
                    <li key={c.id} data-idx={i} role="option" aria-selected={isActive}>
                      <button
                        type="button"
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(c.href)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-fast',
                          isActive ? 'bg-palette-selected text-palette-foreground' : 'text-palette-muted hover:bg-palette-raised',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                        <span className="flex-1 truncate text-sm text-palette-foreground">{c.label}</span>
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-palette-muted">{c.hint}</span>
                        {isActive ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-palette-muted" strokeWidth={1.75} aria-hidden /> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-palette-muted">
                No matches for “{query}”. Try a workspace or page name.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
