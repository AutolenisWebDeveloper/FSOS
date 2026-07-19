// src/lib/analytics/reports.ts
// Native "Book Analytics" — the App B rebuild of App A's live /api/reports.
// App A aggregated the legacy customers/policies/scores/commission_cases/tasks/
// activity tables; here the same headline totals + distributions are derived from
// the App B aggregate-root spine (households, household_policies, cases,
// opportunities, referrals, work_tasks, activities) and the commission views —
// so the reporting library is DB-derived and cannot drift from the modules.

import { getDb, ConfigError } from '@/lib/supabase/client'

const MAX_SCAN = 5000

// Case lifecycle buckets (migration 009 CHECK on cases.status).
const OPEN_CASE_STATUSES = ['submitted', 'underwriting', 'requirements_outstanding', 'approved']
const ISSUED_CASE_STATUSES = ['issued', 'in_service']

export interface Dist {
  label: string
  count: number
}

export interface BookAnalytics {
  generated_at: string
  totals: {
    households: number
    policies: number
    open_cases: number
    issued_cases: number
    open_tasks: number
    overdue_tasks: number
    fsa_commission: number
  }
  pipeline: Dist[]
  sources: Dist[]
  case_status: Dist[]
  activity_30d: Dist[]
  gdc_by_month: { month: string; fsa: number }[]
}

export type BookAnalyticsResult =
  | { ok: true; data: BookAnalytics }
  | { ok: false; kind: 'not_configured' | 'error'; message: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tally(rows: any[] | null, key: string): Dist[] {
  const m = new Map<string, number>()
  for (const r of rows || []) {
    const v = (r[key] ?? 'unknown') as string
    m.set(v, (m.get(v) || 0) + 1)
  }
  return Array.from(m.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

export async function loadBookAnalytics(): Promise<BookAnalyticsResult> {
  try {
    const db = getDb()
    const nowIso = new Date().toISOString()
    const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headCount = async (table: string, build?: (q: any) => any): Promise<number> => {
      let q = db.from(table).select('*', { count: 'exact', head: true })
      if (build) q = build(q)
      const { count } = await q
      return count || 0
    }

    const [
      households,
      policies,
      openCases,
      issuedCases,
      openTasks,
      overdueTasks,
      oppRows,
      refRows,
      caseRows,
      actRows,
      monthRows,
    ] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('households', (q: any) => q.is('deleted_at', null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('household_policies', (q: any) => q.is('deleted_at', null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('cases', (q: any) => q.in('status', OPEN_CASE_STATUSES).is('archived_at', null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('cases', (q: any) => q.in('status', ISSUED_CASE_STATUSES).is('archived_at', null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('work_tasks', (q: any) => q.eq('completed', false).is('deleted_at', null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headCount('work_tasks', (q: any) => q.eq('completed', false).is('deleted_at', null).lt('due_at', nowIso)),
      db.from('opportunities').select('stage').is('deleted_at', null).limit(MAX_SCAN),
      db.from('referrals').select('engagement').is('deleted_at', null).limit(MAX_SCAN),
      db.from('cases').select('status').is('archived_at', null).limit(MAX_SCAN),
      db.from('activities').select('kind').gte('created_at', since30).limit(MAX_SCAN),
      db.from('v_commission_monthly').select('month, fsa_amount').limit(MAX_SCAN),
    ])

    // Realized FSA commission (received/matched) across all months.
    let fsaCommission = 0
    const byMonth = new Map<string, number>()
    for (const r of monthRows.data || []) {
      const fsa = Number(r.fsa_amount) || 0
      fsaCommission += fsa
      const mo = String(r.month)
      byMonth.set(mo, (byMonth.get(mo) || 0) + fsa)
    }
    // Last 6 calendar months, zero-filled.
    const months: string[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      months.push(d.toISOString().slice(0, 7))
    }

    return {
      ok: true,
      data: {
        generated_at: nowIso,
        totals: {
          households,
          policies,
          open_cases: openCases,
          issued_cases: issuedCases,
          open_tasks: openTasks,
          overdue_tasks: overdueTasks,
          fsa_commission: Math.round(fsaCommission),
        },
        pipeline: tally(oppRows.data, 'stage'),
        sources: tally(refRows.data, 'engagement'),
        case_status: tally(caseRows.data, 'status'),
        activity_30d: tally(actRows.data, 'kind'),
        gdc_by_month: months.map((m) => ({ month: m, fsa: Math.round(byMonth.get(m) || 0) })),
      },
    }
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, kind: 'not_configured', message: e.message }
    return { ok: false, kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}
