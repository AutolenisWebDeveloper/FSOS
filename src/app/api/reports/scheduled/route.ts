import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ScheduledReportSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/reports/scheduled — list scheduled report jobs.
// Delivery runs via Vercel Cron; recipients receive the exported file.
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const db = getDb()
    const { data, error } = await db
      .from('scheduled_reports')
      .select('id, report_key, name, cadence, format, recipients, enabled, last_run_at, next_run_at, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ scheduled: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Days until the first run, by cadence.
const CADENCE_DAYS: Record<'daily' | 'weekly' | 'monthly', number> = { daily: 1, weekly: 7, monthly: 30 }

// POST /api/reports/scheduled — schedule a report.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ScheduledReportSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    const nextRunAt = new Date(Date.now() + CADENCE_DAYS[v.data.cadence] * 86400000).toISOString()
    const { data, error } = await db
      .from('scheduled_reports')
      .insert({ ...v.data, enabled: true, next_run_at: nextRunAt, created_by: actor })
      .select('id, report_key, name, cadence, format, recipients, enabled, last_run_at, next_run_at, created_by, created_at, updated_at')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.created', entity: 'scheduled_report', entityId: data.id, diff: { name: data.name, report_key: data.report_key, cadence: data.cadence } })
    return NextResponse.json({ report: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
