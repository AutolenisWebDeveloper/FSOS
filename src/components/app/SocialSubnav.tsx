'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  SOCIAL_OVERVIEW_HREF,
  SOCIAL_SUBNAV_GROUPS,
  isSubnavItemActive,
} from '@/lib/social/subnav'

// Sub-navigation for the AI Social Media Center (ADR-026). Every social route is
// reachable from within the hub, grouped per the build instruction. No route
// changes — this is presentation only. Grouping + active logic live in the pure
// lib/social/subnav module so they are unit-tested.
function SubnavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname()
  const active = exact ? pathname === href : isSubnavItemActive(href, pathname)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-2.5 py-1 text-sm transition-colors',
        active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
    </Link>
  )
}

export function SocialSubnav() {
  return (
    <nav aria-label="Social sections" className="mb-4 rounded-lg border bg-card p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SubnavLink href={SOCIAL_OVERVIEW_HREF} label="Overview" exact />
        {SOCIAL_SUBNAV_GROUPS.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-1 border-l pl-2">
            <span className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</span>
            {g.items.map((it) => (
              <SubnavLink key={it.href} href={it.href} label={it.label} />
            ))}
          </div>
        ))}
      </div>
    </nav>
  )
}
