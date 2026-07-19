import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/cases', label: 'Cases' },
  { href: '/admin/documents', label: 'Documents' },
  { href: '/admin/data/imports', label: 'Data Imports' },
  { href: '/admin/data/exports', label: 'Data Exports' },
  { href: '/admin/data/duplicates', label: 'Duplicates' },
  { href: '/admin/support/requests', label: 'Support' },
  { href: '/admin/users', label: 'Users' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin', '/admin')
  return (
    <PortalShell portalLabel="Admin" nav={NAV}>
      {children}
    </PortalShell>
  )
}
