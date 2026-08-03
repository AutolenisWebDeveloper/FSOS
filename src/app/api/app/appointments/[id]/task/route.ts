import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { createAppointmentFollowupTask } from '@/lib/appointments/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Create a single internal follow-up task for an appointment (§13.4). Green-zone: an internal
// work_tasks row + audit, deduplicated against an open manual task. Contacts no one; any outreach
// that results still flows through the workforce + the 7-step gate.

const uuid = z.string().uuid()
const TaskSchema = z.object({
  title: z.string().trim().max(200).optional(),
  dueInDays: z.coerce.number().int().min(1).max(365).optional(),
})

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
  const v = TaskSchema.safeParse(parsed.data ?? {})
  if (!v.success) return NextResponse.json({ error: 'Invalid request', details: v.error.flatten() }, { status: 400 })

  try {
    const result = await createAppointmentFollowupTask(actorOf(auth.session), apptId.data, {
      title: v.data.title,
      dueInDays: v.data.dueInDays,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status ?? 500 })
    return NextResponse.json(result)
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create the follow-up task' }, { status: 500 })
  }
}
