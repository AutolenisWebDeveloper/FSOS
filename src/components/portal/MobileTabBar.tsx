'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TabItem {
  href: string
  label: string
  /** Pre-rendered lucide element (rendered by the server shell). */
  icon?: React.ReactNode
}

/**
 * Mobile bottom tab bar (docs/design-system.md §4): 5 primary items + an overflow
 * entry. Dark shell background to match the desktop chrome. Hidden ≥ md.
 */
export function MobileTabBar({ items, overflowHref }: { items: TabItem[]; overflowHref: string }) {
  const pathname = usePathname()
  const primary = items.slice(0, 5)
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t border-shell-border bg-shell md:hidden"
    >
      {primary.map((item) => {
        const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
              active ? 'text-accent' : 'text-shell-foreground/70',
            )}
          >
            {item.icon}
            <span className="truncate px-0.5">{item.label}</span>
          </Link>
        )
      })}
      <Link
        href={overflowHref}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-shell-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        <span>More</span>
      </Link>
    </nav>
  )
}
