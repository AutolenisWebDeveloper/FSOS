'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  COMMS_OVERVIEW_HREF,
  COMMS_SUBNAV_GROUPS,
  activeSubnavGroup,
  isSubnavItemActive,
} from '@/lib/comms/subnav'

/*
 * Slice 9A — sub-navigation for the AI Communications Center. Every comms route stays
 * reachable from within the hub. No route changes — this is presentation only. The
 * grouping and active-state logic live in the pure `lib/comms/subnav` module so they
 * are unit-tested, matching the lib/social/subnav precedent.
 *
 * Rebuilt as two tiers. The previous version rendered all 21 destinations at once in a
 * single flex-wrap row: on a laptop it wrapped to three dense lines of same-weight
 * links where the group labels competed with the links themselves, and below `lg` it
 * collapsed to `flex-col` — a 21-item vertical wall pushing the actual page content
 * below the fold on every comms route.
 *
 * Now: tier one is the five sections (always visible, so the shape of the workspace is
 * legible at a glance); tier two is only the current section's destinations. Everything
 * stays reachable in at most two clicks. Both tiers scroll horizontally rather than
 * wrapping, so the navigation occupies a fixed two lines at every width.
 */

/** Horizontal scroller: fixed height at every width, no wrap, no vertical wall. */
function Rail({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      // `-mx-1 px-1` keeps focus rings from being clipped by overflow-x-auto.
      className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={label}
    >
      {children}
    </div>
  )
}

const LINK_BASE =
  'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-sm transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

export function CommsSubnav() {
  const pathname = usePathname()
  const group = activeSubnavGroup(pathname)
  const onOverview = pathname === COMMS_OVERVIEW_HREF

  return (
    <nav aria-label="Communications sections" className="mb-4 space-y-1 rounded-lg border bg-card p-2">
      <Rail label="Sections">
        <Link
          href={COMMS_OVERVIEW_HREF}
          aria-current={onOverview ? 'page' : undefined}
          className={cn(
            LINK_BASE,
            'font-medium',
            onOverview ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          Overview
        </Link>
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
        {COMMS_SUBNAV_GROUPS.map((g) => {
          const active = group?.label === g.label
          return (
            <Link
              key={g.label}
              // A section points at its first destination — the section header itself
              // is not a route, and inventing one would be a route change.
              href={g.items[0].href}
              aria-current={active ? 'true' : undefined}
              className={cn(
                LINK_BASE,
                'font-medium',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {g.label}
            </Link>
          )
        })}
      </Rail>

      {/* Tier two: only the active section's destinations. A single-destination
          section (Templates) has nothing to add, so the row is omitted rather than
          rendering one lonely duplicate link. */}
      {group && group.items.length > 1 ? (
        <>
          <div aria-hidden className="h-px bg-border" />
          <Rail label={`${group.label} pages`}>
            {group.items.map((item) => {
              const active = isSubnavItemActive(item.href, pathname)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    LINK_BASE,
                    active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </Rail>
        </>
      ) : null}
    </nav>
  )
}
