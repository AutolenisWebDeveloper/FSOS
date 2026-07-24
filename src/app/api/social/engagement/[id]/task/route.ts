import { NextRequest, NextResponse } from 'next/server'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { EngagementTaskSchema } from '@/lib/social/schema'
import { createTaskFromEngagement } from '@/lib/social/engagement'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const { id } = await props.params

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = EngagementTaskSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid task', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const res = await createTaskFromEngagement(id, { title: v.data.title, dueAt: v.data.due_at }, actor)
    if (!res.ok) {
      const status = res.kind === 'not_found' ? 404 : res.kind === 'invalid' ? 422 : 500
      return NextResponse.json({ error: res.message }, { status })
    }
    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'work_task',
      entityId: res.data.taskId,
      diff: { event: 'social.engagement.task_created', engagement_id: id },
    })
    return NextResponse.json({ task_id: res.data.taskId }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
