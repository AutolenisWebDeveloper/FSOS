import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/client', label: 'Home' },
  { href: '/client/schedule', label: 'Schedule' },
  { href: '/client/intake', label: 'Intake' },
  { href: '/client/appointments', label: 'Appointments' },
  { href: '/client/documents', label: 'Documents' },
  { href: '/client/reviews', label: 'Reviews' },
  { href: '/client/case-status', label: 'Case Status' },
  { href: '/client/education', label: 'Education' },
  { href: '/client/preferences', label: 'Preferences' },
  { href: '/client/consent', label: 'Consent' },
]

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireRole('client', '/client')
  return (
    <PortalShell portalLabel="Client" nav={NAV}>
      {children}
    </PortalShell>
  )
}
