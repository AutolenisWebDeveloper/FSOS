import {
  Home,
  Calendar,
  CalendarCheck,
  ClipboardList,
  FolderOpen,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Settings as SettingsIcon,
  FileCheck2,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'

export const dynamic = 'force-dynamic'

const NAV: NavItem[] = [
  { href: '/client', label: 'Home', icon: Home, group: 'Overview' },
  { href: '/client/schedule', label: 'Schedule', icon: Calendar, group: 'Appointments' },
  { href: '/client/appointments', label: 'Appointments', icon: CalendarCheck, group: 'Appointments' },
  { href: '/client/intake', label: 'Intake', icon: ClipboardList, group: 'Records' },
  { href: '/client/documents', label: 'Documents', icon: FolderOpen, group: 'Records' },
  { href: '/client/reviews', label: 'Reviews', icon: ClipboardCheck, group: 'Records' },
  { href: '/client/case-status', label: 'Case Status', icon: FileText, group: 'Records' },
  { href: '/client/education', label: 'Education', icon: GraduationCap, group: 'Overview' },
  { href: '/client/preferences', label: 'Preferences', icon: SettingsIcon, group: 'Account' },
  { href: '/client/consent', label: 'Consent', icon: FileCheck2, group: 'Account' },
]

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireRole('client', '/client')
  return (
    <PortalShell portalLabel="Client" nav={NAV} settingsHref="/client/preferences">
      {children}
    </PortalShell>
  )
}
