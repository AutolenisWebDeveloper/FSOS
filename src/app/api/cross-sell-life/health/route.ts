import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Operational monitoring (§21) for the Cross-Sell Life Campaign runner: how many executions have
// dead-lettered (need operator attention), how many are scheduled-but-overdue on their retry, how
// many enrollments are live, and when each cron last ran. Read-only; FSA portal. Cron last-run is
// read from job_runs (the durable dedupe ledger — dedupe_key `${job}:${date}`, the `job` column is
// the plain job name), which every cron handler writes via runIdempotent (lib/jobs/runtime).
const CRON_JOBS = ['cross-sell-life-tick', 'cross-sell-life-enroll', 'cross-sell-life-retry'] as const

export async function GET(_req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response

  try {
    const db = getDb()
    const nowISO = new Date().toISOString()

    const [deadLetter, stuck, running, jobRows] = await Promise.all([
      db.from('xsell_life_campaign_executions').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter'),
      db
        .from('xsell_life_campaign_executions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'scheduled')
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', nowISO),
      db.from('xsell_life_campaign_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'running'),
      db
        .from('job_runs')
        .select('job, status, started_at, finished_at')
        .in('job', CRON_JOBS as unknown as string[])
        .order('started_at', { ascending: false })
        .limit(300),
    ])

    // Reduce to the most recent run per job (rows already ordered newest-first).
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
        dead_letter_executions: deadLetter.count ?? 0,
        scheduled_stuck_executions: stuck.count ?? 0,
        running_enrollments: running.count ?? 0,
      },
      cron: lastRun,
      checked_at: nowISO,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load health' }, { status: 500 })
  }
}
