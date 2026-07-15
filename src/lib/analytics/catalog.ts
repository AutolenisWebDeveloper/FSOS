// src/lib/analytics/catalog.ts
// The custom-dashboard WIDGET CATALOG — pure constants, safe to import from both
// client (the builder form) and server (metric compute + render). Every widget
// resolves to a real, DB-derived metric in lib/analytics/metrics.ts; the saved
// dashboard layout only pins WHICH widgets and in WHAT order, so a dashboard can
// never drift from the data. Each widget links to its underlying list (A1 rule:
// no dead-end tiles).

export type WidgetKind = 'count' | 'currency'

export interface WidgetDef {
  key: string
  label: string
  kind: WidgetKind
  /** Where the tile links to — the underlying list/detail (anti-dead-end). */
  href: string
  hint?: string
}

export const DASHBOARD_WIDGETS = [
  { key: 'agency_partnerships', label: 'Agency partnerships', kind: 'count', href: '/app/agencies', hint: 'Aggregate root of FSOS' },
  { key: 'open_opportunities', label: 'Open opportunities', kind: 'count', href: '/app/opportunities/board', hint: 'In pipeline' },
  { key: 'households', label: 'Households', kind: 'count', href: '/app/households' },
  { key: 'policies', label: 'Policies', kind: 'count', href: '/app/policies' },
  { key: 'referrals_awaiting', label: 'Referrals awaiting action', kind: 'count', href: '/app/referrals', hint: 'Speed-to-lead' },
  { key: 'ai_escalations', label: 'AI escalations', kind: 'count', href: '/app/ai/escalations', hint: 'Awaiting human review' },
  { key: 'overdue_tasks', label: 'Overdue tasks', kind: 'count', href: '/app/tasks', hint: 'Past due' },
  { key: 'conversions_due', label: 'Conversions due (≤90d)', kind: 'count', href: '/app/conversions', hint: 'Educational outreach only' },
  { key: 'cross_sell_targets', label: 'Cross-sell targets', kind: 'count', href: '/app/cross-sell' },
  { key: 'expected_commission_open', label: 'Expected commission (open)', kind: 'currency', href: '/app/opportunities', hint: 'Un-weighted pipeline' },
  { key: 'weighted_pipeline', label: 'Weighted pipeline forecast', kind: 'currency', href: '/app/forecasts', hint: 'Probability-weighted' },
  { key: 'commission_ytd', label: 'FSA commission YTD', kind: 'currency', href: '/app/commissions', hint: 'Reconciled to date' },
] as const satisfies readonly WidgetDef[]

export type WidgetKey = (typeof DASHBOARD_WIDGETS)[number]['key']

export const WIDGET_KEYS = DASHBOARD_WIDGETS.map((w) => w.key) as [WidgetKey, ...WidgetKey[]]

export function widgetDef(key: string): WidgetDef | undefined {
  return DASHBOARD_WIDGETS.find((w) => w.key === key)
}
