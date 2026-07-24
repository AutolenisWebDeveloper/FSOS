'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Slice 9A — sub-navigation for the AI Communications Center. Makes every comms route
// reachable from within the hub, grouped per the Slice 9 spec. Detail routes
// (campaigns/[id], inbox/[id], templates/[id], the campaign simulation preview) are
// reached from their list pages, so they highlight their parent here. No route changes.
const GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: 'Campaigns',
    items: [
      { href: '/app/comms/campaigns', label: 'Campaigns' },
      { href: '/app/comms/campaigns/new', label: 'New' },
      { href: '/app/comms/sequences', label: 'Sequences' },
      { href: '/app/comms/audience', label: 'Audience' },
      { href: '/app/comms/library', label: 'Library' },
    ],
  },
  {
    label: 'Conversations',
    items: [
      { href: '/app/comms/inbox', label: 'Inbox' },
      { href: '/app/comms/sms', label: 'SMS' },
      { href: '/app/comms/email', label: 'Email' },
    ],
  },
  {
    label: 'Templates',
    items: [{ href: '/app/comms/templates', label: 'Templates' }],
  },
  {
    label: 'Governance',
    items: [
      { href: '/app/comms/suppression', label: 'Suppression' },
      { href: '/app/comms/assignments', label: 'Assignment Review' },
      { href: '/app/comms/identity', label: 'Identity Disclosure' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { href: '/app/comms/analytics', label: 'Analytics' },
      { href: '/app/comms/delivery', label: 'Delivery' },
    ],
  },
]

function useIsActive(href: string, exact = false): boolean {
  const pathname = usePathname()
  // Overview (exact) must not light up on every child route (all start with /app/comms).
  if (exact) return pathname === href
  if (href === '/app/comms/campaigns') {
    // Don't let the list swallow its own /new sibling's active state.
    return pathname === href || (pathname.startsWith(href + '/') && pathname !== '/app/comms/campaigns/new')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

function SubnavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const active = useIsActive(href, exact)
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

export function CommsSubnav() {
  return (
    <nav aria-label="Communications sections" className="mb-4 rounded-lg border bg-card p-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SubnavLink href="/app/comms" label="Overview" exact />
        {GROUPS.map((g) => (
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
