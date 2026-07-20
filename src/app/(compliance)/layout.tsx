import {
  ShieldCheck,
  ScrollText,
  MessageSquare,
  FileCheck2,
  BadgeCheck,
  ShieldAlert,
  AlertTriangle,
  Gavel,
  ClipboardCheck,
  BookMarked,
  Presentation,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/compliance', label: 'Overview', icon: ShieldCheck, group: 'Overview' },
  { href: '/compliance/audit', label: 'Audit', icon: ScrollText, group: 'Monitoring' },
  { href: '/compliance/communications', label: 'Communications', icon: MessageSquare, group: 'Monitoring' },
  { href: '/compliance/consent', label: 'Consent', icon: FileCheck2, group: 'Monitoring' },
  { href: '/compliance/firewall', label: 'Firewall', icon: ShieldAlert, group: 'Monitoring' },
  { href: '/compliance/incidents', label: 'Incidents', icon: AlertTriangle, group: 'Monitoring' },
  { href: '/compliance/workshops', label: 'Workshop review', icon: Presentation, group: 'Monitoring' },
  { href: '/compliance/licenses', label: 'Licenses', icon: BadgeCheck, group: 'Governance' },
  { href: '/compliance/legal-holds', label: 'Legal Holds', icon: Gavel, group: 'Governance' },
  { href: '/compliance/attestations', label: 'Attestations', icon: ClipboardCheck, group: 'Governance' },
  { href: '/compliance/policies', label: 'Policies', icon: BookMarked, group: 'Governance' },
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
