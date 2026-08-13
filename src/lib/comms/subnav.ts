// AI Communications Center — sub-navigation config (Slice 9A). PURE +
// offline-testable, so the grouping is asserted in tests and the client component
// stays a thin render. Mirrors the established lib/social/subnav pattern rather than
// keeping the config inline in the component, where it could not be covered.
//
// Every comms route stays reachable from within the hub. Detail routes
// (campaigns/[id], inbox/[id], templates/[id]) are reached from their list page and
// highlight their parent here. No route changes.

export interface CommsSubnavItem {
  href: string
  label: string
}
export interface CommsSubnavGroup {
  label: string
  items: CommsSubnavItem[]
}

export const COMMS_OVERVIEW_HREF = '/app/comms'

export const COMMS_SUBNAV_GROUPS: CommsSubnavGroup[] = [
  {
    label: 'Campaigns',
    items: [
      { href: '/app/comms/campaigns', label: 'All campaigns' },
      { href: '/app/comms/campaigns/new', label: 'New' },
      { href: '/app/comms/sequences', label: 'Sequences' },
      { href: '/app/comms/audience', label: 'Audience' },
      { href: '/app/comms/library', label: 'Library' },
      { href: '/app/comms/life-conversion', label: 'Life conversion' },
      { href: '/app/comms/cross-sell-life', label: 'Cross-sell life' },
      { href: '/app/comms/pipeline-winback', label: 'Win-back' },
      { href: '/app/comms/district-nurture', label: 'Second conversation' },
    ],
  },
  {
    label: 'Conversations',
    items: [
      { href: '/app/comms/console', label: 'Console' },
      { href: '/app/comms/inbox', label: 'Inbox' },
      { href: '/app/comms/sms', label: 'SMS' },
      { href: '/app/comms/email', label: 'Email' },
    ],
  },
  {
    label: 'Templates',
    items: [{ href: '/app/comms/templates', label: 'All templates' }],
  },
  {
    label: 'Governance',
    items: [
      { href: '/app/comms/consent', label: 'Consent' },
      { href: '/app/comms/suppression', label: 'Suppression' },
      { href: '/app/comms/assignments', label: 'Assignment review' },
      { href: '/app/comms/identity', label: 'Identity disclosure' },
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

/**
 * Active-state resolution shared by the component and its test. The campaign list
 * must NOT swallow its own /new sibling, but SHOULD highlight for campaigns/[id].
 */
export function isSubnavItemActive(href: string, pathname: string): boolean {
  if (href === '/app/comms/campaigns') {
    return pathname === href || (pathname.startsWith(href + '/') && pathname !== '/app/comms/campaigns/new')
  }
  return pathname === href || pathname.startsWith(href + '/')
}

/**
 * The section a route belongs to — drives tier one of the two-tier nav. Returns null
 * on the overview (which is its own tier-one entry) and on any route not in a group.
 */
export function activeSubnavGroup(pathname: string): CommsSubnavGroup | null {
  return COMMS_SUBNAV_GROUPS.find((g) => g.items.some((i) => isSubnavItemActive(i.href, pathname))) ?? null
}
