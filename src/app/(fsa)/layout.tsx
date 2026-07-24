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
  RotateCcw,
  ArrowLeftRight,
  Shuffle,
  Briefcase,
  DollarSign,
  MessageSquare,
  BookOpen,
  ClipboardList,
  FolderOpen,
  Workflow,
  CheckSquare,
  Calendar,
  GraduationCap,
  Calculator,
  Bot,
  Gauge,
  Wallet,
  AlertTriangle,
  ShieldCheck,
  ScanSearch,
  BarChart3,
  Sparkles,
  Bell,
  Radio,
  Contact,
  PhoneCall,
  Upload,
  Database,
  FileUp,
  LifeBuoy,
  Settings as SettingsIcon,
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
  { href: '/app/ai/workforce', label: 'AI Command Center', icon: Gauge, group: 'Overview' },
  // Slice 8 — planning is now a cross-cutting Overview command center (moved from
  // Pipeline, renamed from "FNA Generator"): it feeds Opportunities, Reviews,
  // Forecasts, Cases, and Revenue, not a single pipeline task.
  { href: '/app/fna', label: 'AI FNA Command Center', icon: FileSignature, group: 'Overview' },
  // Slice 9A — the communications hub is an Overview command center (renamed from "Comms",
  // moved out of Engage). Its /app/comms/inbox shortcut intentionally stays in Engage.
  { href: '/app/comms', label: 'AI Communications Center', icon: Radio, group: 'Overview' },
  { href: '/app/revenue', label: 'Revenue Center', icon: Wallet, group: 'Overview' },
  { href: '/app/notifications', label: 'Notifications', icon: Bell, group: 'Overview' },

  // Production Operations — the highest-priority production workflows, each a
  // command center built on the existing CRM (gaps, own-book policies, the
  // win-back book). Routes and detail pages are unchanged; this section gives
  // them a dedicated home.
  { href: '/app/cross-sell', label: 'Cross-Sell', icon: Shuffle, group: 'Production Operations' },
  { href: '/app/winback', label: 'Life Win-Back', icon: RotateCcw, group: 'Production Operations' },
  { href: '/app/conversions', label: 'Life Conversion', icon: Repeat, group: 'Production Operations' },

  { href: '/app/agencies', label: 'Agencies', icon: Building2, group: 'Book' },
  { href: '/app/contacts', label: 'Contacts', icon: Contact, group: 'Book' },
  { href: '/app/referrals', label: 'Referrals', icon: UserPlus, group: 'Book' },
  { href: '/app/households', label: 'Households', icon: Users, group: 'Book' },
  { href: '/app/policies', label: 'Policies', icon: FileText, group: 'Book' },
  { href: '/app/book/import', label: 'District Book', icon: Database, group: 'Book' },
  { href: '/app/crosssell', label: 'Cross-Sell Import', icon: FileUp, group: 'Book' },
  { href: '/app/winback/import', label: 'Win-Back Import', icon: FileUp, group: 'Book' },
  { href: '/app/conversions/import', label: 'Life Conversion Import', icon: FileUp, group: 'Book' },
  { href: '/app/contacts/review', label: 'Import Review', icon: ClipboardCheck, group: 'Book' },

  { href: '/app/reviews', label: 'Reviews', icon: ClipboardCheck, group: 'Pipeline' },
  { href: '/app/opportunities', label: 'Opportunities', icon: Target, group: 'Pipeline' },
  { href: '/app/opra', label: 'OPRA Transfers', icon: ArrowLeftRight, group: 'Pipeline' },
  { href: '/app/cases', label: 'Cases', icon: Briefcase, group: 'Pipeline' },
  { href: '/app/commissions', label: 'Commissions', icon: DollarSign, group: 'Pipeline' },

  // Inbox stays in Engage as a daily-use shortcut (the hub itself lives in Overview).
  { href: '/app/comms/inbox', label: 'Inbox', icon: MessageSquare, group: 'Engage' },
  { href: '/app/knowledge', label: 'Knowledge Library', icon: BookOpen, group: 'Engage' },
  { href: '/app/contacts/upload', label: 'Contact Upload', icon: Upload, group: 'Engage' },
  { href: '/app/forms', label: 'Client Forms', icon: ClipboardList, group: 'Engage' },
  { href: '/app/workshops', label: 'Workshops', icon: GraduationCap, group: 'Engage' },
  { href: '/app/workshops/review', label: 'Workshop Approvals', icon: ClipboardCheck, group: 'Engage' },
  { href: '/app/documents', label: 'Documents', icon: FolderOpen, group: 'Engage' },
  { href: '/app/workflows', label: 'Workflows', icon: Workflow, group: 'Engage' },
  { href: '/app/tasks', label: 'Tasks', icon: CheckSquare, group: 'Engage' },
  { href: '/app/calendar', label: 'Calendar', icon: Calendar, group: 'Engage' },
  { href: '/app/tools/calculator', label: 'Sales Calculator', icon: Calculator, group: 'Engage' },

  { href: '/app/ai', label: 'AI Operations', icon: Bot, group: 'Operate' },
  { href: '/app/ai/escalations', label: 'AI Escalations', icon: AlertTriangle, group: 'Operate' },
  { href: '/app/assistant', label: 'AI Assistant', icon: Sparkles, group: 'Operate' },
  { href: '/app/compliance', label: 'Compliance', icon: ShieldCheck, group: 'Operate' },
  { href: '/app/compliance/intelligence', label: 'Compliance Intelligence', icon: ScanSearch, group: 'Operate' },
  { href: '/app/reports', label: 'Reports', icon: BarChart3, group: 'Operate' },
  { href: '/app/contacts/ffs', label: 'FFS Contacts', icon: PhoneCall, group: 'Operate' },
  { href: '/app/settings', label: 'Settings', icon: SettingsIcon, group: 'Operate' },
  { href: '/app/help', label: 'Help & Support', icon: LifeBuoy, group: 'Operate' },
]

export default async function FsaLayout({ children }: { children: React.ReactNode }) {
  await requireRole('fsa', '/app')
  const shellData = await loadShellData()
  return (
    <PortalShell
      portalLabel="FSA"
      nav={NAV}
      panels={<ShellCharacterPanels data={shellData} />}
      searchHref="/app/search"
      assistantHref="/app/assistant"
      notificationsHref="/app/notifications"
      settingsHref="/app/settings"
    >
      {children}
    </PortalShell>
  )
}
