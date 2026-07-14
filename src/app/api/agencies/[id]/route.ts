import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { readJson, configErrorResponse } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { AgencyPatchSchema } from '@/lib/validation/schemas'
import { writeAudit } from '@/lib/audit/log'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET one · PATCH edit/archive · DELETE soft-delete. (rbac-matrix Agency row:
// edit = fsa/staff, delete(soft) = fsa/super.)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  try {
    const { data, error } = await getDb()
      .from('agency_partnerships')
      .select('*')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ agency: data })
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
  const v = AgencyPatchSchema.safeParse(parsed.data)
  if (!v.success) return NextResponse.json({ error: 'Invalid update', details: v.error.flatten() }, { status: 400 })

  try {
    const db = getDb()
    const { archived, owner_email, owner_phone, ...fields } = v.data
    const update: Record<string, unknown> = { ...fields, updated_at: new Date().toISOString() }
    if (archived === true) update.archived_at = new Date().toISOString()
    if (archived === false) update.archived_at = null

    const { data, error } = await db
      .from('agency_partnerships')
      .update(update)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (owner_email || owner_phone) {
      await db
        .from('agency_owners')
        .update({ email: owner_email ?? null, phone: owner_phone ?? null })
        .eq('agency_id', params.id)
    }

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.updated',
      entity: 'agency_partnership',
      entityId: params.id,
      diff: v.data as Record<string, unknown>,
    })
    return NextResponse.json({ agency: data })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, ['fsa', 'super_admin'])
  if (denied) return denied
  try {
    const { data, error } = await getDb()
      .from('agency_partnerships')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await writeAudit({
      actor: actorOf(auth.session),
      action: 'entity.deleted',
      entity: 'agency_partnership',
      entityId: params.id,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
