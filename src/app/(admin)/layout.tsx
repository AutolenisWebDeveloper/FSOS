import {
  LayoutDashboard,
  Briefcase,
  FolderOpen,
  FileUp,
  Download,
  CopyCheck,
  LifeBuoy,
  Users,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/admin/cases', label: 'Cases', icon: Briefcase, group: 'Casework' },
  { href: '/admin/documents', label: 'Documents', icon: FolderOpen, group: 'Casework' },
  { href: '/admin/data/imports', label: 'Data Imports', icon: FileUp, group: 'Data' },
  { href: '/admin/data/exports', label: 'Data Exports', icon: Download, group: 'Data' },
  { href: '/admin/data/duplicates', label: 'Duplicates', icon: CopyCheck, group: 'Data' },
  { href: '/admin/support/requests', label: 'Support', icon: LifeBuoy, group: 'Access' },
  { href: '/admin/users', label: 'Users', icon: Users, group: 'Access' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole('admin', '/admin')
  return (
    <PortalShell portalLabel="Admin" nav={NAV}>
      {children}
    </PortalShell>
  )
}
