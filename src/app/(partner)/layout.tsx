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
    { href: '/partner', label: 'Dashboard' },
    { href: '/partner/refer', label: 'Submit Referral' },
    { href: '/partner/referrals', label: 'My Referrals' },
    { href: '/partner/production', label: 'Production' },
    ...(showComp ? [{ href: '/partner/commissions', label: 'Commissions' }] : []),
    { href: '/partner/materials', label: 'Materials' },
    { href: '/partner/training', label: 'Training' },
    { href: '/partner/schedule', label: 'Schedule' },
    { href: '/partner/messages', label: 'Messages' },
    { href: '/partner/tasks', label: 'Tasks' },
    { href: '/partner/settings', label: 'Settings' },
  ]

  return (
    <PortalShell portalLabel="Agency Owner" nav={nav}>
      {children}
    </PortalShell>
  )
}
