'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { activeWorkspace, activeNavHref, PORTAL_HOME, type WorkspacePortal } from '@/lib/workspaces/registry'
import { cn } from '@/lib/utils'

// Breadcrumbs derived from the active workspace + sub-nav + trailing path segments.
// Workspace → (active section) → (humanized detail). Never fabricates a link the
// portal can't reach — every crumb href is a registry route or the portal home.

function humanize(seg: string): string {
  if (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d+$/.test(seg)) return 'Detail'
  return seg
    .replace(/\[.*?\]/g, 'Detail')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

export function Breadcrumbs({ portal }: { portal: WorkspacePortal }) {
  const pathname = usePathname() ?? PORTAL_HOME[portal]
  const ws = activeWorkspace(portal, pathname)
  if (!ws) return null

  const crumbs: { label: string; href?: string }[] = [{ label: ws.label, href: ws.home }]

  const navHref = activeNavHref(ws, pathname)
  const navItem = navHref ? ws.nav.find((n) => n.href === navHref) : undefined
  // Only add the sub-nav crumb when it isn't just the workspace home again.
  if (navItem && navItem.href !== ws.home) crumbs.push({ label: navItem.label, href: navItem.href })

  // Trailing segments beyond the matched nav/home href become non-linked detail.
  const base = navItem?.href ?? ws.home
  if (pathname.startsWith(base) && pathname.length > base.length) {
    const rest = pathname.slice(base.length).split('/').filter(Boolean)
    for (const seg of rest) crumbs.push({ label: humanize(seg) })
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={2} aria-hidden /> : null}
              {c.href && !last ? (
                <Link
                  href={c.href}
                  className="rounded transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {c.label}
                </Link>
              ) : (
                <span className={cn(last && 'font-medium text-foreground')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
