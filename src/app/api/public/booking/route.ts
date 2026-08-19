import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { PublicBookingInput } from '@/lib/booking/config-schemas'
import { bookAppointment } from '@/lib/booking/book'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/public/booking — public appointment booking. No auth. Honeypot + rate-limit +
// Zod at the edge; the service re-validates the slot against live availability and claims it
// atomically (the DB unique index is the double-booking guard). Returns a confirmation with
// NO internal id; the reference code is derived from the (unexposed) cancel token.
export async function POST(req: NextRequest) {
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error

  // Honeypot: a bot that fills `company` is silently accepted (no booking, no signal).
  const honeypot = (parsed.data as { company?: unknown }).company
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    return NextResponse.json({ ok: true })
  }

  const ip = clientIp(req)
  if (!rateLimit(`booking:${ip}`, 8, 60_000)) {
    return NextResponse.json({ error: 'Too many booking attempts. Please try again shortly.' }, { status: 429 })
  }

  const v = PublicBookingInput.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid booking', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await bookAppointment(
      {
        typeSlug: v.data.typeSlug,
        startsAt: v.data.startsAt,
        bookerTimezone: v.data.bookerTimezone,
        name: v.data.name,
        email: v.data.email,
        phone: v.data.phone ?? null,
        reason: v.data.reason,
        notes: v.data.notes ?? null,
        // Separate, affirmative SMS opt-in + server-derived TCPA/A2P evidence context (P5.3).
        smsOptIn: v.data.sms_opt_in === true,
        ip,
        userAgent: req.headers.get('user-agent'),
      },
      new Date().toISOString(),
    )
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'taken' || res.kind === 'unavailable' ? 409 : 500
      const message = res.kind === 'error' ? 'Could not complete your booking. Please try again.' : res.message
      return NextResponse.json({ error: message, reason: res.kind }, { status })
    }
    return NextResponse.json({ ok: true, confirmation: res.confirmation }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not complete your booking. Please try again.' }, { status: 500 })
  }
}
