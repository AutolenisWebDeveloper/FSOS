import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse } from '@/lib/http'
import { requireApiRole } from '@/lib/auth/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Operational monitoring (§21) for the Life Conversion Campaign runner, at parity with the
// Cross-Sell Life health route: how many executions have dead-lettered (need operator attention),
// how many are scheduled-but-overdue on their retry, how many enrollments are live, and when each
// cron last ran. Read-only; FSA portal. Cron last-run is read from job_runs (the durable dedupe
// ledger written by every cron handler via runIdempotent).
//
// Pre-migration tolerance (D9): the dead-letter/retry counts depend on migration 089's columns.
// Each count query is isolated — if the schema isn't migrated yet, that count reports null
// ("unavailable") instead of failing the whole endpoint, so the panel degrades gracefully (§16).
const CRON_JOBS = ['life-conversion-tick', 'life-conversion-retry'] as const

/** Run a head-count query, returning null if it errors (e.g. a column not yet migrated). */
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
      safeCount(db.from('life_campaign_executions').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter')),
      safeCount(
        db
          .from('life_campaign_executions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'scheduled')
          .not('next_retry_at', 'is', null)
          .lte('next_retry_at', nowISO),
      ),
      safeCount(db.from('life_campaign_enrollments').select('id', { count: 'exact', head: true }).eq('status', 'active')),
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
