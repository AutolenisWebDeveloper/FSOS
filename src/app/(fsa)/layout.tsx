import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

// Session is read per request; never statically render a guarded portal.
export const dynamic = 'force-dynamic'

// P0 nav — only routes that resolve in the system-functional phase (Reviews,
// Cases, Commissions, Comms, etc. join the nav as their pages land in P1).
const NAV: NavItem[] = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/agencies', label: 'Agencies' },
  { href: '/app/referrals', label: 'Referrals' },
  { href: '/app/households', label: 'Households' },
  { href: '/app/policies', label: 'Policies' },
  { href: '/app/opportunities', label: 'Opportunities' },
  { href: '/app/tasks', label: 'Tasks' },
  { href: '/app/calendar', label: 'Calendar' },
  { href: '/app/ai/escalations', label: 'AI Escalations' },
  { href: '/app/compliance', label: 'Compliance' },
]

export default async function FsaLayout({ children }: { children: React.ReactNode }) {
  await requireRole('fsa', '/app')
  return (
    <PortalShell portalLabel="FSA" nav={NAV}>
      {children}
    </PortalShell>
  )
}
