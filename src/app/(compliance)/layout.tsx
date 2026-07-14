import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/compliance', label: 'Overview' },
  { href: '/compliance/audit', label: 'Audit' },
  { href: '/compliance/communications', label: 'Communications' },
  { href: '/compliance/consent', label: 'Consent' },
  { href: '/compliance/licenses', label: 'Licenses' },
  { href: '/compliance/firewall', label: 'Firewall' },
  { href: '/compliance/incidents', label: 'Incidents' },
]

// middleware-auth.md §6: the compliance portal renders a standing disclaimer that
// FSOS supervisory views are supplemental to FFS books-and-records systems.
const Banner = (
  <div className="border-b bg-status-pending/10 px-4 py-2 text-center text-xs text-status-pending">
    FSOS supervisory views are supplemental. They do not replace FFS-required supervisory systems or
    books-and-records.
  </div>
)

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  await requireRole('compliance', '/compliance')
  return (
    <PortalShell portalLabel="Compliance" nav={NAV} banner={Banner}>
      {children}
    </PortalShell>
  )
}
