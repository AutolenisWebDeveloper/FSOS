import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { requireInternalAuth } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/reports  (internal)
// Aggregated analytics for the Reports dashboard: totals, pipeline mix, lead
// sources, case-status split, GDC by month, and 30-day activity. Counts use
// head+count queries; distributions aggregate a bounded slice in JS (fine for a
// single agent's book).
const MAX_SCAN = 5000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tally<T extends string>(rows: any[], key: string): Array<{ label: T; count: number }> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = (r[key] ?? 'unknown') as string
    m.set(v, (m.get(v) || 0) + 1)
  }
  return Array.from(m.entries())
    .map(([label, count]) => ({ label: label as T, count }))
    .sort((a, b) => b.count - a.count)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoISO(n: number) {
  return new Date(Date.now() - n * 86_400_000).toISOString()
}

export async function GET(req: NextRequest) {
  const unauthorized = requireInternalAuth(req)
  if (unauthorized) return unauthorized

  const supabase = getDb()
  const today = todayISO()

  const headCount = async (table: string, build?: (q: ReturnType<typeof supabase.from>) => unknown) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (build) q = build(q as any) as typeof q
    const { count } = await q
    return count || 0
  }

  const [
    customersCount,
    policiesCount,
    openCases,
    issuedCases,
    openTasks,
    overdueTasks,
    scoresRows,
    sourceRows,
    caseRows,
    activityRows,
  ] = await Promise.all([
    headCount('customers'),
    headCount('policies'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headCount('commission_cases', (q: any) => q.in('case_status', ['pending', 'submitted'])),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headCount('commission_cases', (q: any) => q.in('case_status', ['issued', 'paid'])),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headCount('tasks', (q: any) => q.eq('status', 'open')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headCount('tasks', (q: any) => q.eq('status', 'open').lt('due_date', today)),
    supabase.from('scores').select('primary_pipeline').limit(MAX_SCAN),
    supabase.from('customers').select('source').limit(MAX_SCAN),
    supabase
      .from('commission_cases')
      .select('case_status, estimated_gdc, issued_date')
      .limit(MAX_SCAN),
    supabase.from('activity').select('type').gte('created_at', daysAgoISO(30)).limit(MAX_SCAN),
  ])

  // GDC by month (last 6 calendar months) from issued cases.
  const months: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    months.push(d.toISOString().slice(0, 7))
  }
  const gdcByMonth = new Map<string, number>(months.map((m) => [m, 0]))
  let gdcTotalIssued = 0
  for (const c of caseRows.data || []) {
    if (['issued', 'paid'].includes(c.case_status) && c.issued_date) {
      const m = String(c.issued_date).slice(0, 7)
      const gdc = Number(c.estimated_gdc) || 0
      gdcTotalIssued += gdc
      if (gdcByMonth.has(m)) gdcByMonth.set(m, (gdcByMonth.get(m) || 0) + gdc)
    }
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    totals: {
      customers: customersCount,
      policies: policiesCount,
      open_cases: openCases,
      issued_cases: issuedCases,
      open_tasks: openTasks,
      overdue_tasks: overdueTasks,
      gdc_issued: Math.round(gdcTotalIssued),
    },
    pipelines: tally(scoresRows.data || [], 'primary_pipeline'),
    sources: tally(sourceRows.data || [], 'source'),
    case_status: tally(caseRows.data || [], 'case_status'),
    activity_30d: tally(activityRows.data || [], 'type'),
    gdc_by_month: months.map((m) => ({ month: m, gdc: Math.round(gdcByMonth.get(m) || 0) })),
  })
}
