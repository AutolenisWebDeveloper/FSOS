// src/lib/analytics/metrics.ts
// SERVER-ONLY metric compute for the custom dashboard builder. Each widget key in
// the catalog resolves here to a real, DB-derived value. Every metric is fetched
// in its own load() so one failing metric renders an error tile without blanking
// the whole dashboard (archetype A1: "page survives one widget failing").

import { load } from '@/lib/data/query'
import { DASHBOARD_WIDGETS, widgetDef, type WidgetKind } from './catalog'
import {
  weightedPipeline,
  normalizeProbabilities,
  type ForecastStage,
  type OpenOpp,
} from './forecast'

const OPEN_STAGE_FILTER = '("placed_issued","lost")'

export interface WidgetValue {
  key: string
  label: string
  kind: WidgetKind
  href: string
  hint?: string
  value: number | null // null = this metric failed to load (tile shows a retry note)
}

type IdRow = { id: string }

async function countOf(fn: Parameters<typeof load<IdRow[]>>[0]): Promise<number | null> {
  const res = await load<IdRow[]>(fn, [])
  return res.ok ? res.data.length : null
}

function yearStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10)
}

async function openOpps(): Promise<OpenOpp[] | null> {
  const res = await load<OpenOpp[]>(
    (db) =>
      db
        .from('opportunities')
        .select('stage, expected_commission, is_security')
        .is('deleted_at', null)
        .not('stage', 'in', OPEN_STAGE_FILTER),
    [],
  )
  return res.ok ? res.data : null
}

async function stageProbabilities(): Promise<Record<ForecastStage, number>> {
  const res = await load<{ probabilities: unknown }[]>(
    (db) => db.from('forecast_settings').select('probabilities').order('updated_at', { ascending: false }).limit(1),
    [],
  )
  const raw = res.ok && res.data[0] ? res.data[0].probabilities : undefined
  return normalizeProbabilities(raw)
}

async function computeOne(key: string): Promise<number | null> {
  switch (key) {
    case 'agency_partnerships':
      return countOf((db) => db.from('agency_partnerships').select('id').is('deleted_at', null))
    case 'open_opportunities':
      return countOf((db) => db.from('opportunities').select('id').is('deleted_at', null).not('stage', 'in', OPEN_STAGE_FILTER))
    case 'households':
      return countOf((db) => db.from('households').select('id').is('deleted_at', null))
    case 'policies':
      return countOf((db) => db.from('household_policies').select('id').is('deleted_at', null))
    case 'referrals_awaiting':
      return countOf((db) => db.from('v_referrals_awaiting_action').select('id'))
    case 'ai_escalations':
      return countOf((db) => db.from('agent_actions').select('id').eq('kind', 'escalation').or('outcome.eq.escalated,outcome.is.null'))
    case 'overdue_tasks':
      return countOf((db) => db.from('work_tasks').select('id').eq('completed', false).lt('due_at', new Date().toISOString()).is('deleted_at', null))
    case 'conversions_due':
      return countOf((db) => db.from('v_conversions_due').select('policy_id').gte('days_remaining', 0).lte('days_remaining', 90))
    case 'cross_sell_targets':
      // The "Cross-sell targets" widget links to /app/cross-sell, which lists
      // household-level gaps from v_cross_sell_gaps. Count that same view so the
      // tile matches the page it drills into. (v_crosssell_targets is the
      // agency-level penetration view and has no household_id — selecting it here
      // was the bug: "column household_id does not exist".)
      return countOf((db) => db.from('v_cross_sell_gaps').select('household_id'))
    case 'expected_commission_open': {
      const opps = await openOpps()
      if (opps === null) return null
      return Math.round(opps.reduce((a, o) => a + (Number(o.expected_commission) || 0), 0))
    }
    case 'weighted_pipeline': {
      const [opps, probs] = await Promise.all([openOpps(), stageProbabilities()])
      if (opps === null) return null
      return Math.round(weightedPipeline(opps, probs).total_weighted)
    }
    case 'commission_ytd': {
      const res = await load<{ fsa_amount: number | null }[]>(
        (db) =>
          db
            .from('commissions')
            .select('fsa_amount')
            .in('reconciliation_status', ['received', 'matched'])
            .gte('paid_on', yearStartIso()),
        [],
      )
      if (!res.ok) return null
      return Math.round(res.data.reduce((a, r) => a + (Number(r.fsa_amount) || 0), 0))
    }
    default:
      return null
  }
}

/** Compute the requested widgets (unknown keys are dropped). Metrics run in parallel. */
export async function computeWidgets(keys: string[]): Promise<WidgetValue[]> {
  const valid = keys.filter((k) => widgetDef(k))
  const values = await Promise.all(valid.map((k) => computeOne(k)))
  return valid.map((key, i) => {
    const def = widgetDef(key)!
    return { key, label: def.label, kind: def.kind, href: def.href, hint: def.hint, value: values[i] }
  })
}

/** The count of catalog widgets — handy for the builder's "select all" affordance. */
export const WIDGET_COUNT = DASHBOARD_WIDGETS.length
