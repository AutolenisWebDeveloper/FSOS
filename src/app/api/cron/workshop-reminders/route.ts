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
import { runReminderPass, runChangePass, runNurturePass } from '@/lib/workshops/comms-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// WS-030 (owner-directed severity): this route triggers a LIVE SEND ENGINE, and the
// `x-vercel-cron` header is client-supplied — whether the platform strips a forged one
// at the edge is NOT VERIFIED and is not relied on. Authorization is the Bearer
// CRON_SECRET, full stop (Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron
// invocations when the env var is provisioned — a go-live checklist item). No secret
// configured → the route refuses everything (fail closed), never header-trust.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return (req.headers.get('authorization') || '') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    // Change notices first (a reschedule/cancellation outranks a routine reminder),
    // then reminders, then nurture. Each pass is independently idempotent.
    const changes = await runChangePass()
    const reminders = await runReminderPass()
    const nurture = await runNurturePass()
    // WS-064: a pass that surfaced query/send errors is a FAILED cron run — return 500
    // so cron dashboards alert instead of reading an invisible { ok:true, handled:0 }.
    const failed = changes.ok === false || reminders.ok === false || nurture.ok === false
    return NextResponse.json(
      { job: 'workshop-reminders', changes, reminders, nurture },
      failed ? { status: 500 } : undefined,
    )
  } catch (err) {
    return NextResponse.json(
      { job: 'workshop-reminders', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
