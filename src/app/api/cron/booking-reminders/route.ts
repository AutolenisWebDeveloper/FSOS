// src/app/api/cron/booking-reminders/route.ts
// Vercel Cron entry point for native-booking appointment notices (Slice 5 / P5). A STATIC
// route segment (takes precedence over the catch-all /api/cron/[job]) that deliberately does
// NOT use that route's runIdempotent(job:DATE) daily lock — a reminder is time-of-day
// sensitive, so it must run sub-daily. Idempotency is the per-leg delivery-ledger claim inside
// each pass (mig 093), so overlapping ticks send at most once.
//
// Two passes run per tick:
//   • reminders   — every configured pre-appointment offset, per enabled channel;
//   • notices — the IMMEDIATE SMS legs (confirmation, reschedule, cancellation, recap,
//     no-show) that did not go out when the appointment changed. Whatever changed the
//     appointment fires those inline and nothing re-invokes them, and SMS — unlike email —
//     has no transactional fallback, so without this a held or failed leg is simply lost.
//
// Every send goes through the existing comms gate (consent, quiet-hours, DNC, approved
// template, recommendation, securities); nothing sends while the reminder template is an
// unapproved draft. Auth mirrors /api/cron/[job]: Vercel Cron header OR a Bearer CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { runBookingReminderPass, runBookingNoticeRetryPass } from '@/lib/booking/notify'
import { configErrorResponse } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Two passes over up to 200 appointments each, every one running the full send gate. The
// platform default is too tight for that, and a tick killed mid-send strands its delivery claim
// (released on a later tick by the ledger reaper, but better not to strand it at all).
export const maxDuration = 60

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
    const now = new Date()
    const result = await runBookingReminderPass(now)
    // Sequential, not parallel: both passes claim on the same ledger, and one shared connection
    // budget is easier to reason about than two concurrent sweeps of the same table.
    const notices = await runBookingNoticeRetryPass(now)
    return NextResponse.json({ job: 'booking-reminders', ...result, notices })
  } catch (err) {
    return (
      configErrorResponse(err) ??
      NextResponse.json({ job: 'booking-reminders', error: 'reminder pass failed' }, { status: 500 })
    )
  }
}
