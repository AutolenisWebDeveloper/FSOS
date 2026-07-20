// src/app/api/cron/workshop-reminders/route.ts
// Dedicated Vercel Cron entry point for the P2 Workshop/Seminar comms engine. This is a
// STATIC route segment, so it takes precedence over the catch-all /api/cron/[job] — and it
// deliberately does NOT use that route's runIdempotent(job:DATE) daily lock, which would
// skip every run after the first each day (wrong for sub-daily reminders like the 1h
// offset). Idempotency here is the per-(registration, channel, kind) send-log claimed
// inside the engine (workshop_message_log), so overlapping ticks + retries produce at most
// one send per slot.
//
// Runs BOTH passes each tick: pre-event reminders + segmented post-event nurture. Every
// client-facing send inside the engine goes through the existing dispatcher/gate (consent,
// DNC, quiet-hours, approved-template, recommendation, securities). is_security workshops
// are excluded and route to FFS. Nothing sends while templates are placeholders.
//
// Auth mirrors /api/cron/[job]: Vercel Cron header OR a Bearer CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { runReminderPass, runNurturePass } from '@/lib/workshops/comms-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorized(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron')) return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    // Reminders first, then nurture. Each pass is independently idempotent.
    const reminders = await runReminderPass()
    const nurture = await runNurturePass()
    return NextResponse.json({ job: 'workshop-reminders', reminders, nurture })
  } catch (err) {
    return NextResponse.json(
      { job: 'workshop-reminders', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
