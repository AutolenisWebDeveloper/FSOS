// src/app/api/cron/booking-reminders/route.ts
// Vercel Cron entry point for native-booking pre-appointment reminders (Slice 5). A STATIC
// route segment (takes precedence over the catch-all /api/cron/[job]) that deliberately does
// NOT use that route's runIdempotent(job:DATE) daily lock — a reminder is time-of-day
// sensitive, so it must run sub-daily. Idempotency is the per-appointment `reminder_sent_at`
// atomic claim inside runBookingReminderPass, so overlapping ticks send at most once.
//
// Every send goes through the existing comms gate (consent, quiet-hours, DNC, approved
// template, recommendation, securities); nothing sends while the reminder template is an
// unapproved draft. Auth mirrors /api/cron/[job]: Vercel Cron header OR a Bearer CRON_SECRET.
import { NextRequest, NextResponse } from 'next/server'
import { runBookingReminderPass } from '@/lib/booking/notify'
import { configErrorResponse } from '@/lib/http'

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
    const result = await runBookingReminderPass(new Date())
    return NextResponse.json({ job: 'booking-reminders', ...result })
  } catch (err) {
    return (
      configErrorResponse(err) ??
      NextResponse.json({ job: 'booking-reminders', error: 'reminder pass failed' }, { status: 500 })
    )
  }
}
