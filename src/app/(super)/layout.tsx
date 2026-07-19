import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  KeyRound,
  Package,
  Plug,
  Bot,
  FlaskConical,
  Percent,
  PhoneCall,
  Workflow,
  Webhook,
  ListChecks,
  MapPin,
  ScrollText,
  Lock,
  DatabaseBackup,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

// P0 nav — Products, Integrations, Jobs, etc. join in P1 as their pages land.
const NAV: NavItem[] = [
  { href: '/super', label: 'Control', icon: LayoutDashboard, group: 'Overview' },
  { href: '/super/users', label: 'Users', icon: Users, group: 'Access' },
  { href: '/super/roles', label: 'Roles', icon: ShieldCheck, group: 'Access' },
  { href: '/super/permissions', label: 'Permissions', icon: KeyRound, group: 'Access' },
  { href: '/super/products', label: 'Products', icon: Package, group: 'Configuration' },
  { href: '/super/integrations', label: 'Integrations', icon: Plug, group: 'Configuration' },
  { href: '/super/ai/policies', label: 'AI Policies', icon: Bot, group: 'Configuration' },
  { href: '/super/ai/sandbox', label: 'AI Sandbox', icon: FlaskConical, group: 'Configuration' },
  { href: '/super/config/gdc-tiers', label: 'GDC Tiers', icon: Percent, group: 'Configuration' },
  { href: '/super/config/ffs-contacts', label: 'FFS Contacts', icon: PhoneCall, group: 'Configuration' },
  { href: '/super/workflows', label: 'Workflows', icon: Workflow, group: 'Operations' },
  { href: '/super/webhooks', label: 'Webhooks', icon: Webhook, group: 'Operations' },
  { href: '/super/jobs', label: 'Jobs', icon: ListChecks, group: 'Operations' },
  { href: '/super/states', label: 'States', icon: MapPin, group: 'Operations' },
  { href: '/super/audit', label: 'Audit', icon: ScrollText, group: 'Operations' },
  { href: '/super/security', label: 'Security', icon: Lock, group: 'Operations' },
  { href: '/super/backups', label: 'Backups', icon: DatabaseBackup, group: 'Operations' },
]

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  await requireRole('super', '/super')
  return (
    <PortalShell portalLabel="Super Admin" nav={NAV}>
      {children}
    </PortalShell>
  )
}
