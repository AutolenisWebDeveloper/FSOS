import {
  Building2,
  Target,
  Home,
  ShieldCheck,
  UserPlus,
  AlertTriangle,
  Clock,
  CalendarClock,
  Repeat,
  Coins,
  TrendingUp,
  Wallet,
  Gauge,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/*
 * Executive-KPI iconography. Maps each dashboard widget key to a lucide glyph so
 * every metric tile has a visual anchor and reads at a glance — the difference
 * between a flat number+label and an executive-grade metric card. Icons are
 * decorative anchors only; they add NO data the backend doesn't already provide
 * (guardrail 2.3: no invented metrics/trends).
 */
export const WIDGET_ICONS: Record<string, LucideIcon> = {
  agency_partnerships: Building2,
  open_opportunities: Target,
  households: Home,
  policies: ShieldCheck,
  referrals_awaiting: UserPlus,
  ai_escalations: AlertTriangle,
  overdue_tasks: Clock,
  conversions_due: CalendarClock,
  cross_sell_targets: Repeat,
  expected_commission_open: Coins,
  weighted_pipeline: TrendingUp,
  commission_ytd: Wallet,
}

export function widgetIcon(key: string): LucideIcon {
  return WIDGET_ICONS[key] ?? Gauge
}
