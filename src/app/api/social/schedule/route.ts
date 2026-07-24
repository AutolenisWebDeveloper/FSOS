import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ScheduleCreateSchema } from '@/lib/social/schema'
import { listQueue, scheduleVersion } from '@/lib/social/schedule'
import type { SocialScheduleStatus } from '@/lib/social/scheduling'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SCHEDULE_STATUSES = ['pending', 'publishing', 'published', 'failed', 'cancelled']

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const statusParam = req.nextUrl.searchParams.get('status')
  const status = statusParam && SCHEDULE_STATUSES.includes(statusParam) ? (statusParam as SocialScheduleStatus) : undefined
  try {
    const res = await listQueue({ status })
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: 500 })
    return NextResponse.json({ entries: res.data }, { status: 200 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to load queue' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ScheduleCreateSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid schedule', details: v.error.flatten() }, { status: 400 })
  }

  const actor = actorOf(auth.session)
  try {
    const res = await scheduleVersion(
      { versionId: v.data.version_id, channelId: v.data.channel_id, scheduledAt: v.data.scheduled_at, timezone: v.data.timezone },
      actor,
    )
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'social_schedule_entry',
      entityId: res.data.id,
      diff: { event: 'social.scheduled', version_id: v.data.version_id, channel_id: v.data.channel_id, scheduled_at: res.data.scheduled_at },
    })
    // Conflict/connection warnings are non-blocking (§0.B) — returned for the UI.
    return NextResponse.json({ entry: res.data, warnings: res.warnings }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to schedule' }, { status: 500 })
  }
}
