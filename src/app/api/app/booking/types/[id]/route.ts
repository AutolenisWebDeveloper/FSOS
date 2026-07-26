import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AppointmentTypeUpdate } from '@/lib/booking/config-schemas'
import { updateAppointmentType, deleteAppointmentType } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/app/booking/types/[id] — update an appointment type.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AppointmentTypeUpdate.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await updateAppointmentType(actorOf(auth.session), id, v.data)
    if (!res.ok) return configErrorToResponse(res, 'update appointment type')
    return NextResponse.json({ id: res.data.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update appointment type' }, { status: 500 })
  }
}

// DELETE /api/app/booking/types/[id] — remove an appointment type.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  try {
    const res = await deleteAppointmentType(actorOf(auth.session), id)
    if (!res.ok) return configErrorToResponse(res, 'delete appointment type')
    return NextResponse.json({ id: res.data.id })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to delete appointment type' }, { status: 500 })
  }
}
