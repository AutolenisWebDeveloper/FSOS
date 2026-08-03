import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { loadManagedAppointment, rescheduleAppointment } from '@/lib/booking/manage'
import { computeSlotsForType } from '@/lib/booking/slots'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// FSA-side reschedule of a native booking (ADR-027; D-P2-1). Authenticated advisor equivalent of
// the public signed-token flow — it reuses the SAME shared mover (lib/booking/manage.ts:
// rescheduleAppointment), so there is ONE reschedule write path, not two. Server-enforced:
//   • advisor auth (requireApiRole('fsa') + requirePermission) BEFORE any work;
//   • the new slot is validated against LIVE availability (computeSlotsForType) — a free-form time
//     that is not an open slot is rejected;
//   • the move is the status-guarded conditional UPDATE (.eq('status','scheduled')) — fail-closed
//     on a concurrent change — and re-anchors the reminder (clears reminder_sent_at) + Zoom time.

const uuid = z.string().uuid()
const MAX_WINDOW_DAYS = 45
const DEFAULT_TZ = 'America/Chicago'

// GET — available slots for THIS appointment's type over the next `days`, in its booker timezone.
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const apptId = uuid.safeParse(params.id)
  if (!apptId.success) return NextResponse.json({ error: 'Invalid appointment id' }, { status: 400 })

  try {
    const managed = await loadManagedAppointment(apptId.data)
    if (!managed) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    const tz = managed.appt.booker_timezone || DEFAULT_TZ
    if (!managed.typeSlug) {
      return NextResponse.json({ timezone: tz, currentStartsAt: managed.appt.starts_at, slots: [] })
    }

    const url = new URL(req.url)
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') || '14', 10) || 14, 1), MAX_WINDOW_DAYS)
    const now = new Date()
    const rangeStart = now.toISOString()
    const rangeEnd = new Date(now.getTime() + days * 86_400_000).toISOString()

    const res = await computeSlotsForType({
      slug: managed.typeSlug,
      rangeStart,
      rangeEnd,
      bookerTimezone: tz,
      now: rangeStart,
    })
    if (!res.ok) return NextResponse.json({ error: 'Could not load availability.' }, { status: 500 })
    return NextResponse.json({ timezone: tz, currentStartsAt: managed.appt.starts_at, slots: res.slots })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not load availability.' }, { status: 500 })
  }
}

const MoveSchema = z.object({ newStartsAt: z.string().datetime() })

// POST — move the appointment to a new slot through the shared mover.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const apptId = uuid.safeParse(params.id)
  if (!apptId.success) return NextResponse.json({ error: 'Invalid appointment id' }, { status: 400 })

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = MoveSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const managed = await loadManagedAppointment(apptId.data)
    if (!managed) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

    const r = await rescheduleAppointment(
      managed.appt,
      managed.typeSlug,
      v.data.newStartsAt,
      new Date().toISOString(),
      actorOf(auth.session),
    )
    if (!r.ok) {
      const status = r.kind === 'taken' || r.kind === 'unavailable' || r.kind === 'not_reschedulable' ? 409 : 500
      return NextResponse.json({ error: r.message, reason: r.kind }, { status })
    }
    return NextResponse.json({ ok: true, startsAt: r.startsAt, endsAt: r.endsAt })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Could not reschedule.' }, { status: 500 })
  }
}
