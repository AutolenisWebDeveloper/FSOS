// src/lib/dashboards/executive.ts
// Loader for the Executive Dashboard (OS-01, /app). Composes the curated premium
// dashboard entirely from REAL signals — the same views/tables the executive
// briefing, revenue center, and metric catalog already use. No fabricated numbers,
// no mock series; a section with no data degrades to an empty state in the UI.
// Thin-route rule (CLAUDE.md §3.1.8): the page calls this, then renders.

import { load, loadAll } from '@/lib/data/query'
import { type WidgetValue } from '@/lib/analytics/metrics'
import { conversionFunnel, revenueSummary, type OppRow } from '@/lib/revenue/center'
import { stageLabel } from '@/lib/analytics/forecast'

export type Severity = 'high' | 'medium' | 'low'

export interface PriorityItem {
  key: string
  label: string
  count: number
  href: string
  note: string
  severity: Severity
}

export interface FunnelPoint {
  label: string
  value: number
  href: string
}

export interface ActivityItem {
  id: string
  kind: string
  note: string | null
  entity_type: string | null
  created_at: string
}

export interface ExecutiveDashboard {
  /** The AI-briefing headline signals (real counts). */
  briefing: { openOpps: number; expectedOpen: number; crossSell: number; conversionsDue: number; escalations: number }
  /** Ranked "needs attention" queue — only non-zero items, highest severity first. */
  priorities: PriorityItem[]
  /** Real conversion funnel (monotonic counts at/past each stage). */
  funnel: FunnelPoint[]
  /** Revenue roll-up (non-securities; securities tracked separately by the summary). */
  revenue: { expectedOpen: number; actualWon: number; openCount: number; wonCount: number }
  /** Most recent book activity. */
  activities: ActivityItem[]
}

const OPP_COLS = 'id, stage, is_security, source, premium, expected_commission, actual_commission, household_id, contact_id, updated_at'

function n(list: { length: number } | null | undefined): number {
  return list ? list.length : 0
}
function w(map: Map<string, WidgetValue>, key: string): number {
  const v = map.get(key)
  return v && typeof v.value === 'number' ? v.value : 0
}

export async function getExecutiveDashboard(widgetList: WidgetValue[]): Promise<ExecutiveDashboard> {
  const [slaRefs, dueConv, discrepancies, escalations, opps, activities] = await Promise.all([
    load<{ id: string }[]>((db) => db.from('v_referrals_awaiting_action').select('id').eq('sla_breached', true).limit(500), []),
    load<{ policy_id: string }[]>((db) => db.from('v_conversions_due').select('policy_id').eq('urgency_tier', '30').eq('is_security', false).limit(500), []),
    load<{ id: string }[]>((db) => db.from('commissions').select('id').eq('reconciliation_status', 'discrepancy').limit(500), []),
    load<{ id: string }[]>((db) => db.from('agent_actions').select('id').eq('kind', 'escalation').eq('outcome', 'escalated').limit(500), []),
    loadAll<OppRow>((db) => db.from('opportunities').select(OPP_COLS).is('deleted_at', null)),
    load<ActivityItem[]>((db) => db.from('activities').select('id, kind, note, entity_type, created_at').order('created_at', { ascending: false }).limit(8), []),
  ])

  const widgets = new Map((widgetList ?? []).map((v) => [v.key, v]))
  const oppRows = opps.ok ? opps.data : []
  const rev = revenueSummary(oppRows)
  const funnelSteps = conversionFunnel(oppRows)

  // Map funnel stages → labeled, linked points for the chart.
  const funnel: FunnelPoint[] = funnelSteps.map((s) => ({
    label: stageLabel(s.stage),
    value: s.count,
    href: s.stage === 'placed_issued' ? '/app/cases' : '/app/opportunities/board',
  }))

  const slaCount = slaRefs.ok ? n(slaRefs.data) : 0
  const convCount = dueConv.ok ? n(dueConv.data) : 0
  const discCount = discrepancies.ok ? n(discrepancies.data) : 0
  const escCount = escalations.ok ? n(escalations.data) : 0

  // Priority queue — real signals, ranked by severity, zeros dropped.
  const all: PriorityItem[] = [
    { key: 'escalations', label: 'AI escalations awaiting review', count: escCount, href: '/app/ai/escalations', note: 'Human-handoff queue — review and resolve.', severity: 'high' },
    { key: 'sla', label: 'SLA-breached referrals', count: slaCount, href: '/app/referrals', note: 'Untouched past SLA — needs first contact.', severity: 'high' },
    { key: 'discrepancies', label: 'Commission discrepancies', count: discCount, href: '/app/commissions/discrepancies', note: 'Expected vs. received gaps to reconcile.', severity: 'medium' },
    { key: 'overdue', label: 'Overdue tasks', count: w(widgets, 'overdue_tasks'), href: '/app/tasks', note: 'Past their due date.', severity: 'medium' },
    { key: 'conversions', label: 'Conversion windows closing (≤30d)', count: convCount, href: '/app/conversions/eligible?tier=30', note: 'Invite to a review — educational only.', severity: 'medium' },
    { key: 'referrals', label: 'Referrals awaiting triage', count: w(widgets, 'referrals_awaiting'), href: '/app/referrals', note: 'New leads to route — speed-to-lead.', severity: 'low' },
  ]
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 }
  const priorities = all.filter((p) => p.count > 0).sort((a, b) => rank[a.severity] - rank[b.severity])

  return {
    briefing: {
      openOpps: w(widgets, 'open_opportunities'),
      expectedOpen: w(widgets, 'expected_commission_open'),
      crossSell: w(widgets, 'cross_sell_targets'),
      conversionsDue: convCount,
      escalations: escCount,
    },
    priorities,
    funnel,
    revenue: { expectedOpen: rev.expectedOpen, actualWon: rev.actualWon, openCount: rev.openCount, wonCount: rev.wonCount },
    activities: activities.ok ? activities.data : [],
  }
}
