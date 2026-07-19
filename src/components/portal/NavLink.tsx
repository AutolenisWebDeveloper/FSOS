'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Left-nav item for the dark shell (docs/design-system.md §5.2): 36px tall,
 * DM Sans 14px, shell-foreground @82%. Active = raised bg + 2px accent left bar +
 * full-opacity 600 text. `icon` is a pre-rendered element (the server shell renders
 * the lucide icon so no component function crosses the client boundary).
 */
export function NavLink({
  href,
  label,
  icon,
  count,
}: {
  href: string
  label: string
  icon?: React.ReactNode
  count?: number
}) {
  const pathname = usePathname()
  const active =
    pathname === href || (href !== '/app' && href !== '/' && pathname.startsWith(href + '/'))
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-2 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell',
        active
          ? 'bg-shell-raised font-semibold text-shell-foreground [&_svg]:text-accent'
          : 'text-shell-foreground/75 hover:bg-shell-raised/70 hover:text-shell-foreground [&_svg]:text-shell-muted hover:[&_svg]:text-shell-foreground',
      )}
    >
      {/* Active indicator — a short rounded accent bar (premium nav affordance). */}
      {active ? (
        <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
      ) : null}
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span className="numeric inline-flex min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground shadow-elev-xs">
          {count}
        </span>
      ) : null}
    </Link>
  )
}
