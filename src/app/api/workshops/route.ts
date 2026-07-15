import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopCreateSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/workshops — create a workshop (docs/legacy-port.md §2.5). Starts in
// 'draft'; publish it from the detail page to open public registration.
// Roles: fsa, licensed_staff, admin (+ super_admin).
export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopCreateSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid workshop', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data, error } = await db
      .from('workshops')
      .insert({
        title: v.data.title,
        topic: v.data.topic,
        description: v.data.description ?? null,
        scheduled_at: new Date(v.data.scheduled_at).toISOString(),
        location: v.data.location ?? null,
        max_attendees: v.data.max_attendees ?? 50,
        status: 'draft',
      })
      .select('workshop_id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: 'entity.created',
      entity: 'workshop',
      entityId: data.workshop_id,
      diff: { title: v.data.title, topic: v.data.topic },
    })
    return NextResponse.json({ workshop_id: data.workshop_id }, { status: 201 })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to create workshop' }, { status: 500 })
  }
}
