import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AppointmentTypeCreate } from '@/lib/booking/config-schemas'
import { listAppointmentTypes, createAppointmentType } from '@/lib/booking/config'
import { configErrorToResponse } from '@/lib/booking/route-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/app/booking/types — list appointment types (FSA config).
export async function GET() {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const res = await listAppointmentTypes()
    if (!res.ok) return configErrorToResponse(res, 'list appointment types')
    return NextResponse.json({ types: res.data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load appointment types' }, { status: 500 })
  }
}

// POST /api/app/booking/types — create an appointment type.
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = AppointmentTypeCreate.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid appointment type', details: v.error.flatten() }, { status: 400 })

  try {
    const res = await createAppointmentType(actorOf(auth.session), v.data)
    if (!res.ok) return configErrorToResponse(res, 'create appointment type')
    return NextResponse.json({ id: res.data.id }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create appointment type' }, { status: 500 })
  }
}
