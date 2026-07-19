import {
  LayoutDashboard,
  UserPlus,
  Users,
  TrendingUp,
  DollarSign,
  FolderOpen,
  GraduationCap,
  Calendar,
  MessageSquare,
  CheckSquare,
  Settings as SettingsIcon,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'
import { agencyIdsFor, compDisclosureEnabled } from '@/lib/portal/scope'

export const dynamic = 'force-dynamic'

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireRole('partner', '/partner')
  // Comp disclosure gates the commissions nav (hidden entirely when off; deep link 403s).
  const agencyIds = await agencyIdsFor(session)
  const showComp = await compDisclosureEnabled(agencyIds)

  const nav: NavItem[] = [
    { href: '/partner', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
    { href: '/partner/production', label: 'Production', icon: TrendingUp, group: 'Overview' },
    ...(showComp ? [{ href: '/partner/commissions', label: 'Commissions', icon: DollarSign, group: 'Overview' }] : []),
    { href: '/partner/refer', label: 'Submit Referral', icon: UserPlus, group: 'Referrals' },
    { href: '/partner/referrals', label: 'My Referrals', icon: Users, group: 'Referrals' },
    { href: '/partner/materials', label: 'Materials', icon: FolderOpen, group: 'Resources' },
    { href: '/partner/training', label: 'Training', icon: GraduationCap, group: 'Resources' },
    { href: '/partner/schedule', label: 'Schedule', icon: Calendar, group: 'Resources' },
    { href: '/partner/messages', label: 'Messages', icon: MessageSquare, group: 'Account' },
    { href: '/partner/tasks', label: 'Tasks', icon: CheckSquare, group: 'Account' },
    { href: '/partner/settings', label: 'Settings', icon: SettingsIcon, group: 'Account' },
  ]

  return (
    <PortalShell portalLabel="Agency Owner" nav={nav} settingsHref="/partner/settings">
      {children}
    </PortalShell>
  )
}
