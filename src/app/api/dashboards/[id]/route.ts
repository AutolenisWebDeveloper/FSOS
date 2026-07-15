import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { DashboardPatchSchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SELECT = 'id, name, description, layout, visibility, created_by, updated_by, archived_at, created_at, updated_at'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb().from('dashboards').select(SELECT).eq('id', params.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ dashboard: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = DashboardPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { updated_by: actor, updated_at: new Date().toISOString() }
    if (v.data.name !== undefined) patch.name = v.data.name
    if (v.data.description !== undefined) patch.description = v.data.description
    if (v.data.visibility !== undefined) patch.visibility = v.data.visibility
    if (v.data.layout !== undefined) patch.layout = v.data.layout
    if (v.data.archived !== undefined) patch.archived_at = v.data.archived ? new Date().toISOString() : null

    const { data, error } = await db.from('dashboards').update(patch).eq('id', params.id).select(SELECT).single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })

    await writeAudit({
      actor,
      action: v.data.archived === true ? 'entity.deleted' : 'entity.updated',
      entity: 'dashboard',
      entityId: params.id,
      diff: { fields: Object.keys(v.data) },
    })
    return NextResponse.json({ dashboard: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'licensed_staff', 'super_admin'])
  if (denied) return denied
  try {
    const db = getDb()
    const actor = actorOf(auth.session)
    // Soft-delete (archive) — never a hard delete from the UI.
    const { data, error } = await db
      .from('dashboards')
      .update({ archived_at: new Date().toISOString(), updated_by: actor })
      .eq('id', params.id)
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Delete failed' }, { status: 500 })
    await writeAudit({ actor, action: 'entity.deleted', entity: 'dashboard', entityId: params.id })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
