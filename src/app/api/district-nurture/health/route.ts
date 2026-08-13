import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Operational monitoring for the District Agent FS Nurture runner, at parity with the other
// engines: dead-lettered executions, scheduled-but-overdue retries, live enrollments, and the
// last cron runs. Read-only; FSA portal. Each count is isolated so a pre-migration schema
// degrades gracefully (null = unavailable) instead of failing the whole endpoint.
const CRON_JOBS = ['district-nurture-tick', 'district-nurture-retry'] as const

async function safeCount(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try {
    const { count, error } = await q
    return error ? null : (count ?? 0)
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const nowISO = new Date().toISOString()

    const [deadLetter, stuck, active, jobRows] = await Promise.all([
      safeCount(db.from('district_nurture_executions').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter')),
      safeCount(
        db
          .from('district_nurture_executions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'scheduled')
          .not('next_retry_at', 'is', null)
          .lte('next_retry_at', nowISO),
      ),
      safeCount(db.from('district_nurture_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'active')),
      db
        .from('job_runs')
        .select('job, status, started_at, finished_at')
        .in('job', CRON_JOBS as unknown as string[])
        .order('started_at', { ascending: false })
        .limit(300),
    ])

    const lastRun: Record<string, { status: string; started_at: string; finished_at: string | null } | null> = {}
    for (const job of CRON_JOBS) lastRun[job] = null
    for (const r of jobRows.data ?? []) {
      const job = r.job as string
      if (job in lastRun && lastRun[job] === null) {
        lastRun[job] = { status: r.status as string, started_at: r.started_at as string, finished_at: (r.finished_at as string | null) ?? null }
      }
    }

    return NextResponse.json({
      counts: {
        dead_letter_executions: deadLetter,
        scheduled_stuck_executions: stuck,
        active_enrollments: active,
      },
      cron: lastRun,
      checked_at: nowISO,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load health' }, { status: 500 })
  }
}
