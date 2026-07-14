import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/partner', label: 'Dashboard' },
  { href: '/partner/refer', label: 'Submit Referral' },
  { href: '/partner/referrals', label: 'My Referrals' },
  { href: '/partner/production', label: 'Production' },
  { href: '/partner/materials', label: 'Materials' },
  { href: '/partner/messages', label: 'Messages' },
  { href: '/partner/settings', label: 'Settings' },
]

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  await requireRole('partner', '/partner')
  return (
    <PortalShell portalLabel="Agency Owner" nav={NAV}>
      {children}
    </PortalShell>
  )
}
