import {
  LayoutDashboard,
  LayoutGrid,
  TrendingUp,
  Newspaper,
  Building2,
  UserPlus,
  Users,
  FileText,
  FileSignature,
  ClipboardCheck,
  Target,
  Repeat,
  Shuffle,
  Briefcase,
  DollarSign,
  MessageSquare,
  FolderOpen,
  Workflow,
  CheckSquare,
  Calendar,
  Bot,
  AlertTriangle,
  ShieldCheck,
  BarChart3,
} from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { PortalShell, type NavItem } from '@/components/portal/PortalShell'
import { ShellCharacterPanels } from '@/components/portal/CharacterPanels'
import { loadShellData } from '@/lib/data/shell'

// Session is read per request; never statically render a guarded portal.
export const dynamic = 'force-dynamic'

// P0 nav grouped into OS clusters (design-system.md §5.2) with lucide icons.
const NAV: NavItem[] = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { href: '/app/dashboards', label: 'Dashboards', icon: LayoutGrid, group: 'Overview' },
  { href: '/app/forecasts', label: 'Forecasts', icon: TrendingUp, group: 'Overview' },
  { href: '/app/executive/briefing', label: 'Briefing', icon: Newspaper, group: 'Overview' },

  { href: '/app/agencies', label: 'Agencies', icon: Building2, group: 'Book' },
  { href: '/app/referrals', label: 'Referrals', icon: UserPlus, group: 'Book' },
  { href: '/app/households', label: 'Households', icon: Users, group: 'Book' },
  { href: '/app/policies', label: 'Policies', icon: FileText, group: 'Book' },

  { href: '/app/reviews', label: 'Reviews', icon: ClipboardCheck, group: 'Pipeline' },
  { href: '/app/fna', label: 'FNA Generator', icon: FileSignature, group: 'Pipeline' },
  { href: '/app/opportunities', label: 'Opportunities', icon: Target, group: 'Pipeline' },
  { href: '/app/conversions', label: 'Term Conversion', icon: Repeat, group: 'Pipeline' },
  { href: '/app/cross-sell', label: 'Cross-Sell', icon: Shuffle, group: 'Pipeline' },
  { href: '/app/cases', label: 'Cases', icon: Briefcase, group: 'Pipeline' },
  { href: '/app/commissions', label: 'Commissions', icon: DollarSign, group: 'Pipeline' },

  { href: '/app/comms', label: 'Comms', icon: MessageSquare, group: 'Engage' },
  { href: '/app/documents', label: 'Documents', icon: FolderOpen, group: 'Engage' },
  { href: '/app/workflows', label: 'Workflows', icon: Workflow, group: 'Engage' },
  { href: '/app/tasks', label: 'Tasks', icon: CheckSquare, group: 'Engage' },
  { href: '/app/calendar', label: 'Calendar', icon: Calendar, group: 'Engage' },

  { href: '/app/ai', label: 'AI Operations', icon: Bot, group: 'Operate' },
  { href: '/app/ai/escalations', label: 'AI Escalations', icon: AlertTriangle, group: 'Operate' },
  { href: '/app/compliance', label: 'Compliance', icon: ShieldCheck, group: 'Operate' },
  { href: '/app/reports', label: 'Reports', icon: BarChart3, group: 'Operate' },
]

export default async function FsaLayout({ children }: { children: React.ReactNode }) {
  await requireRole('fsa', '/app')
  const shellData = await loadShellData()
  return (
    <PortalShell portalLabel="FSA" nav={NAV} panels={<ShellCharacterPanels data={shellData} />}>
      {children}
    </PortalShell>
  )
}
