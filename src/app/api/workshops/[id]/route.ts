import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { WorkshopPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PATCH /api/workshops/[id] — update status (publish/cancel/complete) or details.
// Publishing opens public registration at /events/[id]. Roles: fsa, licensed_staff, admin.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'admin', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = WorkshopPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  const actor = actorOf(auth.session)
  try {
    const db = getDb()
    const { data, error } = await db
      .from('workshops')
      .update({ ...v.data, updated_at: new Date().toISOString() })
      .eq('workshop_id', params.id)
      .select('workshop_id, status')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) return NextResponse.json({ error: 'Workshop not found' }, { status: 404 })

    await writeAudit({
      actor,
      action: v.data.status ? 'stage.changed' : 'entity.updated',
      entity: 'workshop',
      entityId: params.id,
      diff: v.data,
    })
    return NextResponse.json({ ok: true, status: data[0].status })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed to update workshop' }, { status: 500 })
  }
}
