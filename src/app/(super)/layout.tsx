import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

// P0 nav — Products, Integrations, Jobs, etc. join in P1 as their pages land.
const NAV: NavItem[] = [
  { href: '/super', label: 'Control' },
  { href: '/super/users', label: 'Users' },
  { href: '/super/roles', label: 'Roles' },
  { href: '/super/permissions', label: 'Permissions' },
  { href: '/super/products', label: 'Products' },
  { href: '/super/integrations', label: 'Integrations' },
  { href: '/super/ai/policies', label: 'AI Policies' },
  { href: '/super/jobs', label: 'Jobs' },
  { href: '/super/states', label: 'States' },
  { href: '/super/audit', label: 'Audit' },
  { href: '/super/security', label: 'Security' },
  { href: '/super/backups', label: 'Backups' },
]

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  await requireRole('super', '/super')
  return (
    <PortalShell portalLabel="Super Admin" nav={NAV}>
      {children}
    </PortalShell>
  )
}
