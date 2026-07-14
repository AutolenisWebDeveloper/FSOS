import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/super', label: 'Control' },
  { href: '/super/users', label: 'Users' },
  { href: '/super/roles', label: 'Roles' },
  { href: '/super/permissions', label: 'Permissions' },
  { href: '/super/products', label: 'Products' },
  { href: '/super/ai/policies', label: 'AI Policies' },
  { href: '/super/integrations', label: 'Integrations' },
  { href: '/super/audit', label: 'Audit' },
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
