// AI Social Media Center — sub-navigation config (ADR-026). PURE + offline-testable,
// so the grouping is asserted in tests and the client component stays a thin render.
// Makes every social route reachable from within the hub, grouped per the build
// instruction: Content · Publishing · Engagement · Insight · Setup. Detail routes
// (content/[id]) are reached from their list page and highlight their parent here.

export interface SocialSubnavItem {
  href: string
  label: string
}
export interface SocialSubnavGroup {
  label: string
  items: SocialSubnavItem[]
}

export const SOCIAL_OVERVIEW_HREF = '/app/social'

export const SOCIAL_SUBNAV_GROUPS: SocialSubnavGroup[] = [
  {
    label: 'Content',
    items: [
      { href: '/app/social/content', label: 'Content' },
      { href: '/app/social/content/new', label: 'New' },
    ],
  },
  {
    label: 'Publishing',
    items: [
      { href: '/app/social/calendar', label: 'Calendar' },
      { href: '/app/social/queue', label: 'Queue' },
    ],
  },
  {
    label: 'Engagement',
    items: [{ href: '/app/social/engagement', label: 'Engagement' }],
  },
  {
    label: 'Insight',
    items: [{ href: '/app/social/analytics', label: 'Analytics' }],
  },
  {
    label: 'Setup',
    items: [{ href: '/app/social/accounts', label: 'Accounts' }],
  },
]

// Active-state resolution shared by the component and its test. The content list
// must NOT swallow its own /new sibling, but SHOULD highlight for content/[id].
export function isSubnavItemActive(href: string, pathname: string): boolean {
  if (href === '/app/social/content') {
    return pathname === href || (pathname.startsWith(href + '/') && pathname !== '/app/social/content/new')
  }
  return pathname === href || pathname.startsWith(href + '/')
}
