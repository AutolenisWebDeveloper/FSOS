import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { resolveManageToken, cancelAppointment, rescheduleAppointment } from '@/lib/booking/manage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Public self-service manage endpoint (Slice 6). Token-gated (signed, expiring, single-
// purpose); no id is exposed. GET returns a safe summary for the manage page; POST cancels
// or reschedules. Rate-limited; the token is the only access control.

// GET /api/public/booking/manage?t=<signed> — summary for the manage page.
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`booking-manage:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }
  const token = (new URL(req.url).searchParams.get('t') || '').trim()
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 })
  try {
    const res = await resolveManageToken(token)
    if (!res.ok) {
      return NextResponse.json({ error: res.kind === 'invalid' ? 'This link is invalid or has expired.' : 'Appointment not found.' }, { status: res.kind === 'invalid' ? 410 : 404 })
    }
    return NextResponse.json({
      purpose: res.purpose,
      appointment: {
        typeName: res.typeName,
        typeSlug: res.typeSlug,
        startsAt: res.appt.starts_at,
        bookerTimezone: res.appt.booker_timezone,
        meetingMode: res.appt.meeting_mode,
        status: res.appt.status,
        durationMinutes: res.appt.duration_minutes,
      },
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not load the appointment.' }, { status: 500 })
  }
}

const ManageAction = z.discriminatedUnion('action', [
  z.object({ t: z.string().min(1), action: z.literal('cancel'), reason: z.string().trim().max(500).optional() }),
  z.object({ t: z.string().min(1), action: z.literal('reschedule'), newStartsAt: z.string().datetime({ offset: true }) }),
])

// POST /api/public/booking/manage — cancel or reschedule via the signed token.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`booking-manage-post:${ip}`, 12, 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again shortly.' }, { status: 429 })
  }
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ManageAction.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const resolved = await resolveManageToken(v.data.t)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.kind === 'invalid' ? 'This link is invalid or has expired.' : 'Appointment not found.' }, { status: resolved.kind === 'invalid' ? 410 : 404 })
    }
    // The token's purpose must match the requested action (single-purpose links).
    if (resolved.purpose !== v.data.action) {
      return NextResponse.json({ error: 'This link cannot perform that action.' }, { status: 403 })
    }

    if (v.data.action === 'cancel') {
      const r = await cancelAppointment(resolved.appt, v.data.reason ?? null)
      if (!r.ok) {
        return NextResponse.json({ error: r.message, reason: r.kind }, { status: r.kind === 'not_cancellable' ? 409 : 500 })
      }
      return NextResponse.json({ ok: true, action: 'cancel' })
    }

    const r = await rescheduleAppointment(resolved.appt, resolved.typeSlug, v.data.newStartsAt, new Date().toISOString())
    if (!r.ok) {
      const status = r.kind === 'taken' || r.kind === 'unavailable' ? 409 : r.kind === 'not_reschedulable' ? 409 : 500
      return NextResponse.json({ error: r.message, reason: r.kind }, { status })
    }
    return NextResponse.json({ ok: true, action: 'reschedule', startsAt: r.startsAt })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not complete your request.' }, { status: 500 })
  }
}
