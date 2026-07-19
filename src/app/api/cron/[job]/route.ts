// src/app/api/cron/[job]/route.ts
// Vercel Cron entry point. Verifies the cron secret, then runs the named job
// idempotently (dedupe key = job:date) with the durable runtime. Every cron
// handler checks the kill switch inside its own logic (P1) and routes client-
// facing output through the dispatcher.
import { NextRequest, NextResponse } from 'next/server'
import { JOBS, isJob } from '@/jobs'
import { runIdempotent } from '@/lib/jobs/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // Vercel Cron sends this header; a Bearer secret supports manual/other triggers.
  if (req.headers.get('x-vercel-cron')) return true
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest, props: { params: Promise<{ job: string }> }) {
  const params = await props.params;
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { job } = params
  if (!isJob(job)) {
    return NextResponse.json({ error: `unknown job: ${job}` }, { status: 404 })
  }

  const day = new Date().toISOString().slice(0, 10)
  try {
    const outcome = await runIdempotent(`${job}:${day}`, job, () => JOBS[job]())
    if (outcome.skipped) {
      return NextResponse.json({ job, skipped: true, reason: 'already ran for this window' })
    }
    return NextResponse.json({ job, ...outcome.result })
  } catch (err) {
    return NextResponse.json(
      { job, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
