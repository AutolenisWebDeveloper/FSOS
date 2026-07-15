import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'
import { GdcTierPanel } from '@/components/portal/panels/GdcTierPanel'
import { FfsContactsPanel } from '@/components/portal/panels/FfsContactsPanel'
import { loadGdcTierState } from '@/lib/data/gdc'
import { loadFfsContacts } from '@/lib/data/ffs'

// Session is read per request; never statically render a guarded portal.
export const dynamic = 'force-dynamic'

// P0 nav — only routes that resolve in the system-functional phase (Reviews,
// Cases, Commissions, Comms, etc. join the nav as their pages land in P1).
const NAV: NavItem[] = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/dashboards', label: 'Dashboards' },
  { href: '/app/forecasts', label: 'Forecasts' },
  { href: '/app/executive/briefing', label: 'Briefing' },
  { href: '/app/agencies', label: 'Agencies' },
  { href: '/app/referrals', label: 'Referrals' },
  { href: '/app/households', label: 'Households' },
  { href: '/app/policies', label: 'Policies' },
  { href: '/app/reviews', label: 'Reviews' },
  { href: '/app/opportunities', label: 'Opportunities' },
  { href: '/app/conversions', label: 'Term Conversion' },
  { href: '/app/cross-sell', label: 'Cross-Sell' },
  { href: '/app/cases', label: 'Cases' },
  { href: '/app/commissions', label: 'Commissions' },
  { href: '/app/comms', label: 'Comms' },
  { href: '/app/documents', label: 'Documents' },
  { href: '/app/workflows', label: 'Workflows' },
  { href: '/app/tasks', label: 'Tasks' },
  { href: '/app/calendar', label: 'Calendar' },
  { href: '/app/ai', label: 'AI Operations' },
  { href: '/app/ai/escalations', label: 'AI Escalations' },
  { href: '/app/compliance', label: 'Compliance' },
  { href: '/app/reports', label: 'Reports' },
]

export default async function FsaLayout({ children }: { children: React.ReactNode }) {
  await requireRole('fsa', '/app')
  // Sidebar character panels (design-system.md §5.3) fetch config/production once per
  // navigation; each panel self-hides when its data isn't configured yet.
  const [gdc, ffs] = await Promise.all([loadGdcTierState(), loadFfsContacts(true)])
  return (
    <PortalShell
      portalLabel="FSA"
      nav={NAV}
      panels={
        <>
          <GdcTierPanel state={gdc.ok ? gdc : null} />
          <FfsContactsPanel contacts={ffs.ok ? ffs.contacts : []} />
        </>
      }
    >
      {children}
    </PortalShell>
  )
}
