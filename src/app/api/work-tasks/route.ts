import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// P0 Tasks & Calendar — work_tasks list + create. Distinct from the legacy
// /api/tasks endpoint; this is the FSA "My Tasks" surface.
const CreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  due_at: z.string().datetime({ offset: true }).optional(),
  entity_type: z.string().trim().max(40).optional(),
  entity_id: z.string().uuid().optional(),
})

function dayBounds() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { nowIso: now.toISOString(), startIso: start.toISOString(), endIso: end.toISOString() }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const due = searchParams.get('due')
    const source = searchParams.get('source')

    let query = getDb()
      .from('work_tasks')
      .select('id, title, entity_type, entity_id, assignee, source, due_at, completed, owner_scope, created_at, updated_at')
      .is('deleted_at', null)

    if (source) query = query.eq('source', source)

    const { startIso, endIso } = dayBounds()
    if (due === 'overdue') query = query.eq('completed', false).lt('due_at', startIso)
    else if (due === 'today') query = query.gte('due_at', startIso).lt('due_at', endIso)
    else if (due === 'upcoming') query = query.gte('due_at', endIso)

    const { data, error } = await query.order('due_at', { ascending: true, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tasks: data ?? [] })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = CreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid task', details: v.error.flatten() }, { status: 400 })
  try {
    const insert = {
      title: v.data.title,
      due_at: v.data.due_at ?? null,
      entity_type: v.data.entity_type ?? null,
      entity_id: v.data.entity_id ?? null,
      source: 'manual',
      completed: false,
    }
    const { data, error } = await getDb().from('work_tasks').insert(insert).select('*').maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.created',
      entity: 'task',
      entityId: data?.id ?? null,
      diff: insert as Record<string, unknown>,
    })
    return NextResponse.json({ task: data }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
