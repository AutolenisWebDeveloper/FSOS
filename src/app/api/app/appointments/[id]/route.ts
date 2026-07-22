import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { setAppointmentStatus } from '@/lib/appointments/service'
import { APPOINTMENT_STATUSES } from '@/lib/appointments/recovery'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// AI Revenue Command Center — Appointment lifecycle (§13.4). Advance an appointment's
// status (mark completed / cancelled / no_show, or reschedule back to scheduled) and
// optionally link the originating opportunity. Green-zone: it changes an internal
// record and audits it — it sends nothing. The transition is validated against the pure
// state machine (a bad transition is a 409, never a silent overwrite).

const uuid = z.string().uuid()
const StatusSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  opportunity_id: uuid.optional(),
  note: z.string().trim().max(1000).optional(),
})

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = StatusSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  const apptId = uuid.safeParse(params.id)
  if (!apptId.success) return NextResponse.json({ error: 'Invalid appointment id' }, { status: 400 })

  try {
    const actor = actorOf(auth.session)
    const result = await setAppointmentStatus(actor, apptId.data, v.data.status, {
      opportunityId: v.data.opportunity_id,
      note: v.data.note,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status ?? 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 })
  }
}
