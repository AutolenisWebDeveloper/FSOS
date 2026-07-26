import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse } from '@/lib/http'
import { rateLimit, clientIp } from '@/lib/http/rate-limit'
import { isValidIanaZone } from '@/lib/booking/config-schemas'
import { computeSlotsForType } from '@/lib/booking/slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_WINDOW_DAYS = 45

// GET /api/public/booking/availability?type=<slug>&from=<YYYY-MM-DD>&days=<n>&tz=<IANA>
// Public, read-only: returns bookable slots for one appointment type over a bounded window,
// rendered in the booker's timezone. Rate-limited; no rows other than computed open slots
// are ever exposed.
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  if (!rateLimit(`booking-avail:${ip}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
  }

  const url = new URL(req.url)
  const slug = (url.searchParams.get('type') || '').trim()
  const tz = (url.searchParams.get('tz') || '').trim()
  const from = (url.searchParams.get('from') || '').trim()
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') || '14', 10) || 14, 1), MAX_WINDOW_DAYS)

  if (!slug) return NextResponse.json({ error: 'Missing appointment type.' }, { status: 400 })
  if (!isValidIanaZone(tz)) return NextResponse.json({ error: 'Invalid or missing timezone.' }, { status: 400 })

  // Window: from `from` (a booker-local date) or now, spanning `days`. We compute in UTC and
  // let the pure calculator render in the booker's zone.
  const now = new Date()
  let startMs = now.getTime()
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const parsed = Date.parse(`${from}T00:00:00Z`)
    if (Number.isFinite(parsed)) startMs = Math.max(parsed, now.getTime())
  }
  const rangeStart = new Date(startMs).toISOString()
  const rangeEnd = new Date(startMs + days * 86_400_000).toISOString()

  try {
    const res = await computeSlotsForType({
      slug,
      rangeStart,
      rangeEnd,
      bookerTimezone: tz,
      now: now.toISOString(),
    })
    if (!res.ok) {
      if (res.kind === 'not_found' || res.kind === 'inactive') {
        return NextResponse.json({ error: 'That appointment type is not available.' }, { status: 404 })
      }
      // Internal error — generic message, no detail leaked.
      return NextResponse.json({ error: 'Could not load availability. Please try again.' }, { status: 500 })
    }
    return NextResponse.json({
      type: {
        name: res.type.name,
        slug: res.type.slug,
        description: res.type.description,
        durationMinutes: res.type.duration_minutes,
        meetingMode: res.type.meeting_mode,
      },
      timezone: tz,
      slots: res.slots,
    })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not load availability. Please try again.' }, { status: 500 })
  }
}
