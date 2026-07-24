import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { RescheduleSchema } from '@/lib/social/schema'
import { rescheduleEntry, cancelEntry } from '@/lib/social/schedule'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = RescheduleSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid reschedule', details: v.error.flatten() }, { status: 400 })
  }

  const actor = actorOf(auth.session)
  try {
    const res = await rescheduleEntry(id, v.data.scheduled_at, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_schedule_entry',
      entityId: id,
      diff: { event: 'social.rescheduled', scheduled_at: res.data.scheduled_at },
    })
    return NextResponse.json({ entry: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to reschedule' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const actor = actorOf(auth.session)
  try {
    const res = await cancelEntry(id, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.updated',
      entity: 'social_schedule_entry',
      entityId: id,
      diff: { event: 'social.schedule.cancelled' },
    })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  }
}
