import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { addAppointmentNote } from '@/lib/appointments/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Add an internal note to an appointment (§13.4). Green-zone: writes an activity + audit record,
// sends nothing. The note feeds the command-center "Missing notes" KPI and the detail timeline.

const uuid = z.string().uuid()
const NoteSchema = z.object({ note: z.string().trim().min(1).max(2000) })

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
  const v = NoteSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const result = await addAppointmentNote(actorOf(auth.session), apptId.data, v.data.note)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to add the note' }, { status: 500 })
  }
}
