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
        'group flex h-9 items-center gap-2.5 rounded-xl border-l-2 pl-2.5 pr-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell',
        active
          ? 'border-l-accent bg-shell-raised font-semibold text-shell-foreground'
          : 'border-l-transparent text-shell-foreground/80 hover:bg-shell-raised hover:text-shell-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span className="numeric inline-flex min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  )
}
